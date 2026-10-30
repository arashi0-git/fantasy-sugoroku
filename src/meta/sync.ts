// プロフィールの端末間同期（アカウント同期フェーズ3）。
// ローカルファースト：変更は即 localStorage に保存され（profile.ts の saveProfile）、
// ここは「サーバーへの控えの送信」と「ログイン時の突き合わせ」だけを担う。
// 同期に失敗してもゲームは止めない（未送信フラグを残し、次の機会に再送する）。
//
// 競合ルール（設計仕様書 §6・§10-3）：updated_at が新しい方を丸ごと採用する。
// ただし同期メタが別アカウントのものだった場合は、その端末のローカルは
// 「他人の控え」なのでサーバー側を正とする（§7：別のアカウントでログイン
// し直した場合はサーバー側のデータを正とする）。
// サーバーに自分の行が無いアカウントは初期プロフィールで開始し（§7）、
// その内容でサーバーに行を作る。引き継ぎダイアログは実装しない。

import type { AuthActionResult, AuthState } from './auth';
import { defaultProfile, parseProfile, PROFILE_KEY, serializeProfile, type Profile } from './profile';

/** 同期メタ（最終更新時刻・未送信フラグ・持ち主）の保存キー。fs-profile 本体とは分ける */
export const SYNC_META_KEY = 'fs-profile-sync';

/** サーバー側の自分の行（data は未検証の生JSON。採用前に必ず parseProfile を通す） */
export interface ProfileRow {
  data: unknown;
  /** サーバーが付けた最終更新時刻（ISO文字列） */
  updatedAt: string;
}

/**
 * プロフィール保存APIの最小形。supabase-js の PostgREST 呼び出しをこの形に寄せ、
 * テストでは偽物に差し替えられるようにする（auth.ts の AuthApiLike と同じ考え方）。
 */
export interface ProfileStoreApi {
  /** 自分の行を取得する。無ければ null */
  fetchOwnProfile(userId: string): Promise<ProfileRow | null>;
  /** 自分の行を作成／更新し、サーバー側の updated_at を返す */
  upsertOwnProfile(userId: string, data: Profile): Promise<{ updatedAt: string }>;
  /** 自分の行を削除する（アカウント削除用。RLS の範囲で自分の行だけが対象） */
  deleteOwnProfile(userId: string): Promise<void>;
}

/** localStorage 互換の最小形（テスト差し替え用） */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** 認証状態の供給元（AuthService が構造的にこの形を満たす） */
export interface AuthStateSource {
  getState(): AuthState;
  subscribe(listener: (state: AuthState) => void): () => void;
}

interface SyncMeta {
  /** ローカルに保持しているプロフィールの最終更新時刻（ミリ秒） */
  updatedAt: number;
  /** サーバーへまだ送れていない変更があるか */
  dirty: boolean;
  /** このメタ（とローカルの控え）が属するアカウント。未ログイン運用のみなら null */
  userId: string | null;
}

const FRESH_META: SyncMeta = { updatedAt: 0, dirty: false, userId: null };

function parseMeta(json: string | null): SyncMeta {
  if (!json) return { ...FRESH_META };
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;
    return {
      updatedAt: typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0,
      dirty: raw.dirty === true,
      userId: typeof raw.userId === 'string' ? raw.userId : null,
    };
  } catch {
    return { ...FRESH_META };
  }
}

/**
 * 画面に出す同期状態（フェーズ4）。
 * - signedOut：未ログイン（同期していない）
 * - checking：ログイン状態または初回の突き合わせを確認中
 * - pending：未送信の変更がある、または突き合わせが失敗して再試行待ち
 * - synced：サーバーと揃っている
 */
export type SyncStatus = 'signedOut' | 'checking' | 'pending' | 'synced';

/** 同期状態の導出（純粋関数）。入力は ProfileSync が持つ現在の状態そのもの */
export function deriveSyncStatus(input: {
  authStatus: AuthState['status'];
  dirty: boolean;
  reconciled: boolean;
  reconcileFailed: boolean;
}): SyncStatus {
  if (input.authStatus === 'signedOut') return 'signedOut';
  if (input.authStatus !== 'signedIn') return 'checking';
  if (!input.reconciled) return input.reconcileFailed ? 'pending' : 'checking';
  return input.dirty ? 'pending' : 'synced';
}

export interface ProfileSyncDeps {
  store: ProfileStoreApi;
  storage: KeyValueStorage;
  /** 時刻源（テストで差し替える） */
  now?: () => number;
  /** 連続変更を1回の送信にまとめる待ち時間（ミリ秒） */
  debounceMs?: number;
  /** サーバー側（または初期）プロフィールを採用してローカルを置き換えたときの通知 */
  onProfileAdopted?: (profile: Profile) => void;
}

export class ProfileSync {
  private readonly now: () => number;
  private readonly debounceMs: number;
  private meta: SyncMeta;
  private userId: string | null = null;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private pushing = false;
  /** ログイン直後の突き合わせが終わっているか（終わるまで送信は始めない） */
  private reconciled = false;
  /** 直近で受けた認証状態（同期状態の導出に使う） */
  private authStatus: AuthState['status'] = 'unknown';
  /** 突き合わせが通信失敗で終わっているか（再試行待ちの表示に使う） */
  private reconcileFailed = false;
  private readonly statusListeners = new Set<(status: SyncStatus) => void>();
  private lastStatus: SyncStatus | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly deps: ProfileSyncDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.debounceMs = deps.debounceMs ?? 800;
    this.meta = parseMeta(this.readKey(SYNC_META_KEY));
  }

  /** 認証状態に連動を始める（ログイン→初期同期、ログアウト→同期停止） */
  start(auth: AuthStateSource): void {
    if (this.unsubscribe) return;
    this.unsubscribe = auth.subscribe((state) => this.onAuthState(state));
    this.onAuthState(auth.getState());
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.cancelTimer();
  }

  /**
   * ローカルにプロフィールを保存した直後に呼ぶ（main の保存経路から）。
   * 呼び出し側が先に saveProfile で localStorage へ書いている前提で、
   * ここではメタの更新と、ログイン中なら送信の予約だけを行う。
   */
  noteLocalSave(): void {
    this.meta = { ...this.meta, updatedAt: this.now(), dirty: true };
    this.writeMeta();
    this.schedulePush();
    this.emitSyncStatus();
  }

  /** 現在の同期状態（画面表示用） */
  getSyncStatus(): SyncStatus {
    return deriveSyncStatus({
      authStatus: this.authStatus,
      dirty: this.meta.dirty,
      reconciled: this.reconciled,
      reconcileFailed: this.reconcileFailed,
    });
  }

  /** 同期状態の変化を購読する。戻り値は購読解除関数（変化したときだけ呼ばれる） */
  subscribeSyncStatus(listener: (status: SyncStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  /** 同期状態を再計算し、変わっていれば購読者へ知らせる */
  private emitSyncStatus(): void {
    const next = this.getSyncStatus();
    if (next === this.lastStatus) return;
    this.lastStatus = next;
    for (const listener of this.statusListeners) listener(next);
  }

  /**
   * この端末のローカルデータだけを初期化する（サーバーには触らない）。
   * 「ログアウト＋端末のデータ消去」（§11）と、アカウント削除の後始末で使う。
   * 同期メタも初期化されるため、同じアカウントで再ログインすればサーバー側が正として取り込まれる。
   */
  resetLocalData(): void {
    this.cancelTimer();
    this.userId = null;
    this.reconciled = false;
    this.reconcileFailed = false;
    this.meta = { ...FRESH_META };
    this.writeMeta();
    const fresh = defaultProfile();
    try {
      this.deps.storage.setItem(PROFILE_KEY, serializeProfile(fresh));
    } catch {
      /* 保存できない環境でも通知は行う */
    }
    this.deps.onProfileAdopted?.(fresh);
    this.emitSyncStatus();
  }

  /**
   * アカウント削除のうち、同期層が担う部分（フェーズ4・決定⑦）。
   * サーバー側の自分の profiles 行を削除し、この端末のローカルデータも初期化する。
   * 認証ユーザー自体の削除はクライアント（publishable キー）からは行えないため、
   * 呼び出し側（main）がこの後にログアウトまで行う。認証レコードの完全削除には
   * サーバー側の管理操作（Edge Function 等）が別途必要（§8：service_role は使わない）。
   * サーバー削除に失敗した場合はローカルを一切触らず、失敗を返す。
   */
  async deleteAccount(): Promise<AuthActionResult> {
    const userId = this.userId;
    if (!userId) {
      return { ok: false, message: 'ログインしていないため、アカウントを削除できませんでした。' };
    }
    this.cancelTimer();
    // 送信中の更新が削除の直後に届いて行が復活しないよう、送信の完了を待つ（上限つき）
    for (let i = 0; i < 60 && this.pushing; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    try {
      await this.deps.store.deleteOwnProfile(userId);
    } catch {
      return {
        ok: false,
        message: 'サーバーのデータを削除できませんでした。通信環境を確認してもう一度お試しください。',
      };
    }
    // 削除の間にログアウト／アカウント切替があった場合は、その状態を壊さない
    if (this.userId === userId) this.resetLocalData();
    return { ok: true };
  }

  /** 未送信分があれば今すぐ送る（タイトルへ戻ったとき・オンライン復帰時の保険） */
  async flush(): Promise<void> {
    if (!this.userId || !this.meta.dirty || !this.reconciled) return;
    await this.push();
  }

  /**
   * 同期の再試行：ログイン直後の突き合わせが通信失敗で終わっていたらやり直し、
   * 済んでいれば未送信分の送信を試みる（タイトルへ戻ったとき・オンライン復帰時に呼ぶ）
   */
  async retrySync(): Promise<void> {
    if (!this.userId) return;
    if (!this.reconciled) {
      await this.reconcile();
      return;
    }
    await this.flush();
  }

  /** デバッグ・テスト用に現在のメタを返す */
  getMeta(): Readonly<SyncMeta> {
    return this.meta;
  }

  private onAuthState(state: AuthState): void {
    this.authStatus = state.status;
    if (state.status === 'signedIn' && state.user) {
      if (this.userId === state.user.id && this.reconciled) {
        this.emitSyncStatus();
        return;
      }
      this.userId = state.user.id;
      this.reconciled = false;
      this.reconcileFailed = false;
      this.emitSyncStatus();
      void this.reconcile();
    } else if (state.status === 'signedOut') {
      // ログアウト：同期は止めるが、端末のローカルの控えは消さない（§7）
      this.userId = null;
      this.reconciled = false;
      this.reconcileFailed = false;
      this.cancelTimer();
      this.emitSyncStatus();
    }
    // 'unknown'（確認中）は何もしない。確定してから動く
  }

  /** ログイン直後の突き合わせ：サーバーとローカルの新しい方を丸ごと採用する */
  private async reconcile(): Promise<void> {
    const userId = this.userId;
    if (!userId) return;
    let row: ProfileRow | null;
    try {
      row = await this.deps.store.fetchOwnProfile(userId);
    } catch {
      // 取得できない（オフライン等）間はローカルの控えで続ける。次回ログイン時や
      // オンライン復帰時に改めて突き合わせる。ゲームは止めない
      if (this.userId === userId) {
        this.reconcileFailed = true;
        this.emitSyncStatus();
      }
      return;
    }
    if (this.userId !== userId) return; // 途中でログアウト／切替があったら破棄
    this.reconcileFailed = false;

    if (!row) {
      // サーバーに自分の行が無い＝このアカウントは新規。引き継ぎはしない
      // 決まり（§7）なので、初期プロフィールで開始し、その内容で行を作る
      const fresh = defaultProfile();
      this.adopt(fresh, userId);
      this.meta = { updatedAt: this.now(), dirty: true, userId };
      this.writeMeta();
      this.reconciled = true;
      await this.push();
      return;
    }

    // サーバーから受け取ったJSONは、現行と同じ検証を通してから使う（§8）
    const serverProfile = parseProfile(JSON.stringify(row.data));
    const serverTs = Date.parse(row.updatedAt) || 0;
    const sameAccount = this.meta.userId === userId;

    if (!sameAccount || serverTs > this.meta.updatedAt) {
      // サーバーが新しい、または別アカウントの控えしか無い → サーバーを採用
      this.adopt(serverProfile, userId);
      this.meta = { updatedAt: serverTs, dirty: false, userId };
      this.writeMeta();
    } else if (this.meta.dirty || this.meta.updatedAt > serverTs) {
      // ローカルが新しい → ローカルをサーバーへ送って揃える
      this.meta = { ...this.meta, userId };
      this.writeMeta();
      this.reconciled = true;
      await this.push();
      return;
    } else {
      // 同じ内容（時刻も一致し未送信もなし）
      this.meta = { updatedAt: serverTs, dirty: false, userId };
      this.writeMeta();
    }
    this.reconciled = true;
    // 採用で置き換えた直後に未送信分が残るケースはないが、念のため予約だけ確認
    this.schedulePush();
    this.emitSyncStatus();
  }

  /** プロフィールをローカルへ反映し、画面側へ通知する */
  private adopt(profile: Profile, userId: string): void {
    try {
      this.deps.storage.setItem(PROFILE_KEY, serializeProfile(profile));
    } catch {
      /* 保存できない環境でも通知は行い、表示だけでも揃える */
    }
    this.meta = { ...this.meta, userId };
    this.deps.onProfileAdopted?.(profile);
  }

  private schedulePush(): void {
    if (!this.userId || !this.reconciled || !this.meta.dirty) return;
    this.cancelTimer();
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      void this.push();
    }, this.debounceMs);
  }

  private cancelTimer(): void {
    if (this.pushTimer) {
      clearTimeout(this.pushTimer);
      this.pushTimer = null;
    }
  }

  /** ローカルの現在内容をサーバーへ送る。失敗しても例外にせず未送信のまま残す */
  private async push(): Promise<void> {
    const userId = this.userId;
    if (!userId || this.pushing || !this.meta.dirty) return;
    this.pushing = true;
    const sentJson = this.readKey(PROFILE_KEY);
    const profile = parseProfile(sentJson);
    try {
      const { updatedAt } = await this.deps.store.upsertOwnProfile(userId, profile);
      if (this.userId !== userId) return; // 送信中にログアウト／切替があったら結果を捨てる
      const serverTs = Date.parse(updatedAt) || this.now();
      // 送信中にさらに変更が入っていたら、その分は未送信として残し、改めて送る
      const changedInFlight = this.readKey(PROFILE_KEY) !== sentJson;
      this.meta = {
        updatedAt: changedInFlight ? this.meta.updatedAt : serverTs,
        dirty: changedInFlight,
        userId,
      };
      this.writeMeta();
      if (changedInFlight) this.schedulePush();
    } catch {
      // 送信失敗：未送信フラグを残すだけ（次回保存・ flush ・再ログインで再送される）
    } finally {
      this.pushing = false;
      this.emitSyncStatus();
    }
  }

  private readKey(key: string): string | null {
    try {
      return this.deps.storage.getItem(key);
    } catch {
      return null;
    }
  }

  private writeMeta(): void {
    try {
      this.deps.storage.setItem(SYNC_META_KEY, JSON.stringify(this.meta));
    } catch {
      /* 保存できない環境では同期メタを持ち回らない（同期はベストエフォート） */
    }
  }
}

/**
 * 対戦開始ゲートの判定（全員ログイン制）。
 * - signedIn：開始してよい
 * - signedOut：まずログインが必要（ダイアログを出す）
 * - unknown：ログイン状態の確認が終わるまで開始を保留する（素通りさせない）
 */
export type StartGateDecision = 'allow' | 'needLogin' | 'wait';

export function startGateDecision(status: AuthState['status']): StartGateDecision {
  if (status === 'signedIn') return 'allow';
  if (status === 'signedOut') return 'needLogin';
  return 'wait';
}

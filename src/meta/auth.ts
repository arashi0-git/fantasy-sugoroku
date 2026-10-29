// アカウント（Supabase Auth）の状態管理。
// 「いまログインしているか・誰か」を1か所で持ち、変化を購読できるようにする小さなモジュール。
// Supabase のクライアントそのものには依存せず、認証APIの形（AuthApiLike）だけに依存するので、
// テストでは偽のAPIに差し替えて検証できる。セッションやトークンの保存は supabase-js の
// 標準ストレージ管理に任せ、ここでは自前でトークンを複製・保存しない（設計仕様書 §8）。

/** ログイン中ユーザーの表示に必要な最小限の情報 */
export interface AuthUserInfo {
  id: string;
  email: string | null;
}

/** ログイン状態。起動直後（セッション確認が終わるまで）は 'unknown' */
export type AuthStatus = 'unknown' | 'signedOut' | 'signedIn';

export interface AuthState {
  status: AuthStatus;
  user: AuthUserInfo | null;
}

/** セッションの最小形（supabase-js の Session から、ここで使う項目だけを抜き出した形） */
export interface AuthSessionLike {
  user: { id: string; email?: string | null };
}

interface AuthErrorLike {
  message: string;
}

/**
 * 認証APIの最小形。supabase-js の `client.auth` が構造的にこの形を満たす。
 * テストではこの形の偽物を渡す。
 */
export interface AuthApiLike {
  getSession(): Promise<{ data: { session: AuthSessionLike | null } }>;
  onAuthStateChange(
    callback: (event: string, session: AuthSessionLike | null) => void,
  ): { data: { subscription: { unsubscribe(): void } } };
  signInWithOtp(credentials: {
    email: string;
    options: { emailRedirectTo: string; shouldCreateUser: boolean };
  }): Promise<{ error: AuthErrorLike | null }>;
  signInWithOAuth(credentials: {
    provider: 'google';
    options: { redirectTo: string };
  }): Promise<{ error: AuthErrorLike | null }>;
  signOut(): Promise<{ error: AuthErrorLike | null }>;
}

/** ログイン操作の結果。失敗時は画面に出す日本語メッセージを持つ */
export type AuthActionResult = { ok: true } | { ok: false; message: string };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** メールアドレスの形式チェック（送信前の入力検証用） */
export function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email.trim());
}

export class AuthService {
  private state: AuthState = { status: 'unknown', user: null };
  private readonly listeners = new Set<(state: AuthState) => void>();
  private subscription: { unsubscribe(): void } | null = null;

  /**
   * @param auth 認証API（本番は supabase-js の client.auth、テストは偽物）
   * @param redirectUrl ログイン後に戻る自サイトのURLを返す関数（呼び出し時点のURLから作る）
   */
  constructor(
    private readonly auth: AuthApiLike,
    private readonly redirectUrl: () => string,
  ) {}

  getState(): AuthState {
    return this.state;
  }

  /** 状態の変化を購読する。戻り値は購読解除関数 */
  subscribe(listener: (state: AuthState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * セッションの初期取得と、以降の変化の購読を始める。
   * 購読を先に張ってから現在値を取得し、取りこぼしを防ぐ。
   */
  async init(): Promise<void> {
    if (this.subscription) return;
    const { data } = this.auth.onAuthStateChange((_event, session) => {
      this.applySession(session);
    });
    this.subscription = data.subscription;
    try {
      const { data: current } = await this.auth.getSession();
      this.applySession(current.session);
    } catch {
      // セッション確認に失敗してもアプリは止めない。未ログインとして扱う
      this.setState({ status: 'signedOut', user: null });
    }
  }

  /** 購読を止める（通常はアプリ終了まで張りっぱなしでよい） */
  dispose(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
  }

  /**
   * メールアドレスへマジックリンクを送る。
   * 形式が不正な場合はAPIを呼ばずに入力エラーとして返す。
   * 初めてのアドレスではアカウントも自動で作られる（shouldCreateUser）。
   */
  async signInWithEmail(emailRaw: string): Promise<AuthActionResult> {
    const email = emailRaw.trim();
    if (!isValidEmail(email)) {
      return { ok: false, message: 'メールアドレスの形式を確認してください。' };
    }
    try {
      const { error } = await this.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: this.redirectUrl(), shouldCreateUser: true },
      });
      if (error) {
        return {
          ok: false,
          message: 'ログインリンクを送信できませんでした。時間をおいてもう一度お試しください。',
        };
      }
      return { ok: true };
    } catch {
      return {
        ok: false,
        message: 'ログインリンクを送信できませんでした。通信環境を確認してもう一度お試しください。',
      };
    }
  }

  /**
   * Googleログイン。成功時はブラウザがGoogle側へ遷移する（戻ってくるとセッションが入る）。
   * プロバイダ未設定などで失敗した場合は、穏当な案内を返す（アプリは壊れない）。
   */
  async signInWithGoogle(): Promise<AuthActionResult> {
    try {
      const { error } = await this.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: this.redirectUrl() },
      });
      if (error) {
        return {
          ok: false,
          message: 'Googleログインは現在準備中です。メールアドレスでのログインをお試しください。',
        };
      }
      return { ok: true };
    } catch {
      return {
        ok: false,
        message: 'Googleログインは現在準備中です。メールアドレスでのログインをお試しください。',
      };
    }
  }

  /** ログアウトする。状態の更新は認証イベント経由でも来るが、即時に未ログイン表示へ寄せる */
  async signOut(): Promise<void> {
    try {
      await this.auth.signOut();
    } catch {
      /* ログアウトの通信に失敗しても、表示は未ログイン側へ寄せる */
    }
    this.setState({ status: 'signedOut', user: null });
  }

  private applySession(session: AuthSessionLike | null): void {
    if (session?.user) {
      this.setState({
        status: 'signedIn',
        user: { id: session.user.id, email: session.user.email ?? null },
      });
    } else {
      this.setState({ status: 'signedOut', user: null });
    }
  }

  private setState(next: AuthState): void {
    if (this.state.status === next.status && this.state.user?.id === next.user?.id && this.state.user?.email === next.user?.email) {
      return;
    }
    this.state = next;
    for (const listener of this.listeners) listener(next);
  }
}

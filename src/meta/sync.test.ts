import { describe, expect, it, vi } from 'vitest';
import type { AuthState } from './auth';
import { defaultProfile, parseProfile, PROFILE_KEY, serializeProfile, type Profile } from './profile';
import {
  ProfileSync,
  startGateDecision,
  SYNC_META_KEY,
  type KeyValueStorage,
  type ProfileRow,
  type ProfileStoreApi,
} from './sync';

const USER_A = 'user-a';
const USER_B = 'user-b';
const T0 = 1_700_000_000_000; // 2023-11-14T22:13:20Z

/** メモリ上の KeyValueStorage（localStorage の代わり） */
function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  const storage: KeyValueStorage = {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
  return { storage, map };
}

/** 偽の認証状態ソース。状態を手動で切り替えられる */
function fakeAuth(initial: AuthState = { status: 'unknown', user: null }) {
  let state = initial;
  const listeners = new Set<(s: AuthState) => void>();
  return {
    source: {
      getState: () => state,
      subscribe: (l: (s: AuthState) => void) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
    },
    set(next: AuthState) {
      state = next;
      for (const l of listeners) l(next);
    },
    signIn(id: string) {
      this.set({ status: 'signedIn', user: { id, email: 'p@example.com' } });
    },
    signOut() {
      this.set({ status: 'signedOut', user: null });
    },
  };
}

/** 偽のプロフィール保存API。行を持ち、失敗も仕掛けられる */
function fakeStore(row: ProfileRow | null = null) {
  let current = row;
  let failFetch = false;
  let failUpsert = false;
  const store: ProfileStoreApi = {
    fetchOwnProfile: vi.fn(async () => {
      if (failFetch) throw new Error('network');
      return current;
    }),
    upsertOwnProfile: vi.fn(async (_userId: string, data: Profile) => {
      if (failUpsert) throw new Error('network');
      const updatedAt = new Date(T0 + 60_000).toISOString();
      current = { data: JSON.parse(JSON.stringify(data)) as unknown, updatedAt };
      return { updatedAt };
    }),
  };
  return {
    store,
    setFailFetch(v: boolean) {
      failFetch = v;
    },
    setFailUpsert(v: boolean) {
      failUpsert = v;
    },
    getRow: () => current,
  };
}

function makeSync(opts: {
  storage: KeyValueStorage;
  store: ProfileStoreApi;
  now?: () => number;
  onProfileAdopted?: (p: Profile) => void;
}) {
  return new ProfileSync({
    store: opts.store,
    storage: opts.storage,
    now: opts.now ?? (() => T0),
    debounceMs: 5,
    onProfileAdopted: opts.onProfileAdopted,
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const richProfile = (coins: number): Profile => ({ ...defaultProfile(), coins });

describe('対戦開始ゲートの判定', () => {
  it('ログイン中は許可、未ログインはログイン要求、確認中は保留', () => {
    expect(startGateDecision('signedIn')).toBe('allow');
    expect(startGateDecision('signedOut')).toBe('needLogin');
    expect(startGateDecision('unknown')).toBe('wait');
  });
});

describe('ログイン時の突き合わせ（競合解決）', () => {
  it('サーバーが新しければサーバーのプロフィールを丸ごと採用する', async () => {
    const local = richProfile(10);
    const { storage, map } = fakeStorage({ [PROFILE_KEY]: serializeProfile(local) });
    const server = richProfile(777);
    const { store } = fakeStore({ data: JSON.parse(serializeProfile(server)), updatedAt: new Date(T0 + 1000).toISOString() });
    const adopted: Profile[] = [];
    const sync = makeSync({ storage, store, onProfileAdopted: (p) => adopted.push(p) });
    const auth = fakeAuth();
    sync.start(auth.source);
    auth.signIn(USER_A);
    await sleep(30);
    expect(adopted).toHaveLength(1);
    expect(adopted[0].coins).toBe(777);
    expect(parseProfile(map.get(PROFILE_KEY)!).coins).toBe(777);
    expect(sync.getMeta()).toMatchObject({ dirty: false, userId: USER_A });
    expect(store.upsertOwnProfile).not.toHaveBeenCalled();
  });

  it('ローカルが新しく未送信分があれば、ローカルをサーバーへ送る', async () => {
    const local = richProfile(500);
    const { storage, map } = fakeStorage({
      [PROFILE_KEY]: serializeProfile(local),
      [SYNC_META_KEY]: JSON.stringify({ updatedAt: T0 + 5000, dirty: true, userId: USER_A }),
    });
    const { store, getRow } = fakeStore({
      data: JSON.parse(serializeProfile(richProfile(100))),
      updatedAt: new Date(T0).toISOString(),
    });
    const adopted: Profile[] = [];
    const sync = makeSync({ storage, store, onProfileAdopted: (p) => adopted.push(p) });
    const auth = fakeAuth();
    sync.start(auth.source);
    auth.signIn(USER_A);
    await sleep(30);
    expect(adopted).toHaveLength(0); // ローカル採用なので置き換え通知はなし
    expect(store.upsertOwnProfile).toHaveBeenCalledTimes(1);
    expect((getRow()!.data as Profile).coins).toBe(500);
    expect(sync.getMeta().dirty).toBe(false);
    expect(parseProfile(map.get(PROFILE_KEY)!).coins).toBe(500);
  });

  it('サーバーに行が無ければ初期プロフィールで開始し、その内容で行を作る（引き継ぎなし）', async () => {
    const local = richProfile(999); // 端末に残っていた古いデータは引き継がない
    const { storage, map } = fakeStorage({ [PROFILE_KEY]: serializeProfile(local) });
    const { store, getRow } = fakeStore(null);
    const adopted: Profile[] = [];
    const sync = makeSync({ storage, store, onProfileAdopted: (p) => adopted.push(p) });
    const auth = fakeAuth();
    sync.start(auth.source);
    auth.signIn(USER_A);
    await sleep(30);
    expect(adopted).toHaveLength(1);
    expect(adopted[0]).toEqual(defaultProfile());
    expect(parseProfile(map.get(PROFILE_KEY)!)).toEqual(defaultProfile());
    expect(store.upsertOwnProfile).toHaveBeenCalledTimes(1);
    expect((getRow()!.data as Profile).coins).toBe(0);
  });

  it('別アカウントの同期メタしか無い場合は、ローカルが新しくてもサーバーを採用する', async () => {
    const { storage, map } = fakeStorage({
      [PROFILE_KEY]: serializeProfile(richProfile(999)),
      [SYNC_META_KEY]: JSON.stringify({ updatedAt: T0 + 999_000, dirty: true, userId: USER_B }),
    });
    const { store } = fakeStore({
      data: JSON.parse(serializeProfile(richProfile(50))),
      updatedAt: new Date(T0).toISOString(),
    });
    const adopted: Profile[] = [];
    const sync = makeSync({ storage, store, onProfileAdopted: (p) => adopted.push(p) });
    const auth = fakeAuth();
    sync.start(auth.source);
    auth.signIn(USER_A);
    await sleep(30);
    expect(adopted).toHaveLength(1);
    expect(adopted[0].coins).toBe(50);
    expect(parseProfile(map.get(PROFILE_KEY)!).coins).toBe(50);
    expect(store.upsertOwnProfile).not.toHaveBeenCalled();
  });

  it('サーバーのデータが壊れていても検証を通した安全な形で採用する', async () => {
    const { storage, map } = fakeStorage({});
    const broken = { version: 1, coins: -50, ownedCharIds: ['not-a-char', 42], charXp: { bald: 'x' }, equipped: 'no' };
    const { store } = fakeStore({ data: broken, updatedAt: new Date(T0 + 1000).toISOString() });
    const adopted: Profile[] = [];
    const sync = makeSync({ storage, store, onProfileAdopted: (p) => adopted.push(p) });
    const auth = fakeAuth();
    sync.start(auth.source);
    auth.signIn(USER_A);
    await sleep(30);
    expect(adopted).toHaveLength(1);
    // 不正値は捨てられ、スターターが補完された形になっている
    expect(adopted[0].coins).toBe(0);
    expect(adopted[0].ownedCharIds).toEqual(defaultProfile().ownedCharIds);
    expect(adopted[0].charXp).toEqual({ bald: 0 }); // 数値でない値は 0 に丸められる
    expect(parseProfile(map.get(PROFILE_KEY)!)).toEqual(adopted[0]);

    // 版が違うデータは丸ごとデフォルトとして扱う
    const s2 = fakeStorage({});
    const st2 = fakeStore({ data: { version: 99, coins: 12345 }, updatedAt: new Date(T0 + 1000).toISOString() });
    const adopted2: Profile[] = [];
    const sync2 = makeSync({ storage: s2.storage, store: st2.store, onProfileAdopted: (p) => adopted2.push(p) });
    const auth2 = fakeAuth();
    sync2.start(auth2.source);
    auth2.signIn(USER_A);
    await sleep(30);
    expect(adopted2[0]).toEqual(defaultProfile());
  });

  it('取得に失敗したらローカルを触らず、再試行で突き合わせられる', async () => {
    const local = richProfile(321);
    const { storage, map } = fakeStorage({ [PROFILE_KEY]: serializeProfile(local) });
    const f = fakeStore({ data: JSON.parse(serializeProfile(richProfile(5))), updatedAt: new Date(T0 + 1000).toISOString() });
    f.setFailFetch(true);
    const adopted: Profile[] = [];
    const sync = makeSync({ storage, store: f.store, onProfileAdopted: (p) => adopted.push(p) });
    const auth = fakeAuth();
    sync.start(auth.source);
    auth.signIn(USER_A);
    await sleep(30);
    expect(adopted).toHaveLength(0);
    expect(parseProfile(map.get(PROFILE_KEY)!).coins).toBe(321); // ローカルのまま
    f.setFailFetch(false);
    await sync.retrySync();
    await sleep(10);
    expect(adopted).toHaveLength(1);
    expect(adopted[0].coins).toBe(5);
  });
});

describe('保存時の送信（未送信フラグと再送）', () => {
  async function signedInSync() {
    const { storage, map } = fakeStorage({ [PROFILE_KEY]: serializeProfile(richProfile(0)) });
    const f = fakeStore({
      data: JSON.parse(serializeProfile(richProfile(0))),
      updatedAt: new Date(T0).toISOString(),
    });
    const sync = makeSync({ storage, store: f.store, now: () => T0 + 10_000 });
    const auth = fakeAuth();
    sync.start(auth.source);
    auth.signIn(USER_A);
    await sleep(30);
    vi.mocked(f.store.upsertOwnProfile).mockClear();
    return { sync, map, f };
  }

  it('連続保存は1回の送信にまとまり、最新内容が送られる', async () => {
    const { sync, map, f } = await signedInSync();
    map.set(PROFILE_KEY, serializeProfile(richProfile(100)));
    sync.noteLocalSave();
    map.set(PROFILE_KEY, serializeProfile(richProfile(200)));
    sync.noteLocalSave();
    map.set(PROFILE_KEY, serializeProfile(richProfile(300)));
    sync.noteLocalSave();
    await sleep(30);
    expect(f.store.upsertOwnProfile).toHaveBeenCalledTimes(1);
    expect((f.getRow()!.data as Profile).coins).toBe(300);
    expect(sync.getMeta().dirty).toBe(false);
  });

  it('送信に失敗したら未送信のまま残り、次の保存で再送される', async () => {
    const { sync, map, f } = await signedInSync();
    f.setFailUpsert(true);
    map.set(PROFILE_KEY, serializeProfile(richProfile(111)));
    sync.noteLocalSave();
    await sleep(30);
    expect(sync.getMeta().dirty).toBe(true);
    f.setFailUpsert(false);
    map.set(PROFILE_KEY, serializeProfile(richProfile(222)));
    sync.noteLocalSave();
    await sleep(30);
    expect(f.store.upsertOwnProfile).toHaveBeenCalledTimes(2);
    expect((f.getRow()!.data as Profile).coins).toBe(222);
    expect(sync.getMeta().dirty).toBe(false);
  });

  it('flush で未送信分を即時に送れる', async () => {
    const { sync, map, f } = await signedInSync();
    f.setFailUpsert(true);
    map.set(PROFILE_KEY, serializeProfile(richProfile(111)));
    sync.noteLocalSave();
    await sleep(30);
    expect(sync.getMeta().dirty).toBe(true);
    f.setFailUpsert(false);
    await sync.flush();
    expect((f.getRow()!.data as Profile).coins).toBe(111);
    expect(sync.getMeta().dirty).toBe(false);
  });

  it('ログアウト中は送信せず、ローカルの控えも消さない', async () => {
    const { storage, map } = fakeStorage({ [PROFILE_KEY]: serializeProfile(richProfile(0)) });
    const f = fakeStore({
      data: JSON.parse(serializeProfile(richProfile(0))),
      updatedAt: new Date(T0).toISOString(),
    });
    const sync = makeSync({ storage, store: f.store, now: () => T0 + 10_000 });
    const auth = fakeAuth();
    sync.start(auth.source);
    auth.signIn(USER_A);
    await sleep(30);
    vi.mocked(f.store.upsertOwnProfile).mockClear();
    auth.signOut();
    map.set(PROFILE_KEY, serializeProfile(richProfile(555)));
    sync.noteLocalSave();
    await sleep(30);
    expect(f.store.upsertOwnProfile).not.toHaveBeenCalled();
    expect(parseProfile(map.get(PROFILE_KEY)!).coins).toBe(555); // 控えは残る
    expect(sync.getMeta().dirty).toBe(true);
  });
});

describe('同期メタの読み込み', () => {
  it('壊れたメタは初期値として扱い、落ちない', async () => {
    const { storage } = fakeStorage({
      [PROFILE_KEY]: serializeProfile(richProfile(1)),
      [SYNC_META_KEY]: '{not json',
    });
    const { store } = fakeStore(null);
    const sync = makeSync({ storage, store });
    expect(sync.getMeta()).toEqual({ updatedAt: 0, dirty: false, userId: null });
  });
});

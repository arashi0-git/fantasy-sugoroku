import { describe, expect, it, vi } from 'vitest';
import {
  AuthService,
  isValidEmail,
  type AuthApiLike,
  type AuthSessionLike,
  type AuthState,
} from './auth';
import { authRedirectUrl, SUPABASE_URL } from './supabase';

const USER = { id: 'user-1', email: 'player@example.com' };
const SESSION: AuthSessionLike = { user: USER };

/** テスト用の偽の認証API。呼び出しを記録し、コールバックを手動で発火できる */
function fakeAuth(initialSession: AuthSessionLike | null = null) {
  let callback: ((event: string, session: AuthSessionLike | null) => void) | null = null;
  const api: AuthApiLike = {
    getSession: vi.fn(async () => ({ data: { session: initialSession } })),
    onAuthStateChange: vi.fn((cb) => {
      callback = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }),
    signInWithOtp: vi.fn(async () => ({ error: null })),
    signInWithOAuth: vi.fn(async () => ({ error: null })),
    signOut: vi.fn(async () => ({ error: null })),
  };
  return {
    api,
    emit(session: AuthSessionLike | null) {
      callback?.('SIGNED_IN', session);
    },
  };
}

const REDIRECT = 'https://example.com/fantasy-sugoroku/';
const makeService = (api: AuthApiLike) => new AuthService(api, () => REDIRECT);

describe('メールアドレスの形式チェック', () => {
  it('妥当なアドレスを通す', () => {
    expect(isValidEmail('player@example.com')).toBe(true);
    expect(isValidEmail(' a.b+tag@sub.example.co.jp ')).toBe(true);
  });

  it('形式が崩れたアドレスを弾く', () => {
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail('player')).toBe(false);
    expect(isValidEmail('player@example')).toBe(false);
    expect(isValidEmail('player @example.com')).toBe(false);
    expect(isValidEmail('@example.com')).toBe(false);
  });
});

describe('AuthService の初期状態とセッション取得', () => {
  it('初期状態は unknown、init でセッションが無ければ未ログインになる', async () => {
    const { api } = fakeAuth(null);
    const svc = makeService(api);
    expect(svc.getState().status).toBe('unknown');
    await svc.init();
    expect(svc.getState()).toEqual({ status: 'signedOut', user: null });
  });

  it('保存済みセッションがあればログイン中として復元される', async () => {
    const { api } = fakeAuth(SESSION);
    const svc = makeService(api);
    await svc.init();
    expect(svc.getState()).toEqual({ status: 'signedIn', user: USER });
  });

  it('認証イベントでログイン・ログアウトが購読者へ伝わる', async () => {
    const fake = fakeAuth(null);
    const svc = makeService(fake.api);
    const seen: AuthState[] = [];
    svc.subscribe((s) => seen.push(s));
    await svc.init();
    fake.emit(SESSION);
    expect(svc.getState().status).toBe('signedIn');
    fake.emit(null);
    expect(svc.getState().status).toBe('signedOut');
    expect(seen.map((s) => s.status)).toEqual(['signedOut', 'signedIn', 'signedOut']);
  });

  it('同じ状態が続くときは購読者へ再通知しない', async () => {
    const fake = fakeAuth(SESSION);
    const svc = makeService(fake.api);
    const seen: AuthState[] = [];
    await svc.init();
    svc.subscribe((s) => seen.push(s));
    fake.emit(SESSION);
    expect(seen).toHaveLength(0);
  });

  it('セッション取得に失敗しても未ログインとして扱い、例外にしない', async () => {
    const fake = fakeAuth(null);
    (fake.api.getSession as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network'));
    const svc = makeService(fake.api);
    await expect(svc.init()).resolves.toBeUndefined();
    expect(svc.getState().status).toBe('signedOut');
  });
});

describe('マジックリンク送信', () => {
  it('形式が不正ならAPIを呼ばずに入力エラーを返す', async () => {
    const { api } = fakeAuth();
    const svc = makeService(api);
    const result = await svc.signInWithEmail('not-an-email');
    expect(result.ok).toBe(false);
    expect(api.signInWithOtp).not.toHaveBeenCalled();
  });

  it('妥当なアドレスではリダイレクト先付きで送信する', async () => {
    const { api } = fakeAuth();
    const svc = makeService(api);
    const result = await svc.signInWithEmail(' player@example.com ');
    expect(result).toEqual({ ok: true });
    expect(api.signInWithOtp).toHaveBeenCalledWith({
      email: 'player@example.com',
      options: { emailRedirectTo: REDIRECT, shouldCreateUser: true },
    });
  });

  it('APIエラー時は画面向けの文言に変えて返す', async () => {
    const fake = fakeAuth();
    (fake.api.signInWithOtp as ReturnType<typeof vi.fn>).mockResolvedValue({
      error: { message: 'rate limit' },
    });
    const svc = makeService(fake.api);
    const result = await svc.signInWithEmail('player@example.com');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).not.toContain('rate limit');
  });
});

describe('Googleログインとログアウト', () => {
  it('Googleは自サイトへのリダイレクト付きで開始する', async () => {
    const { api } = fakeAuth();
    const svc = makeService(api);
    await expect(svc.signInWithGoogle()).resolves.toEqual({ ok: true });
    expect(api.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: REDIRECT },
    });
  });

  it('プロバイダ未設定などのエラーは「準備中」の案内に変える', async () => {
    const fake = fakeAuth();
    (fake.api.signInWithOAuth as ReturnType<typeof vi.fn>).mockResolvedValue({
      error: { message: 'Unsupported provider: provider is not enabled' },
    });
    const svc = makeService(fake.api);
    const result = await svc.signInWithGoogle();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('準備中');
  });

  it('ログアウトすると未ログイン状態になる', async () => {
    const fake = fakeAuth(SESSION);
    const svc = makeService(fake.api);
    await svc.init();
    await svc.signOut();
    expect(fake.api.signOut).toHaveBeenCalled();
    expect(svc.getState()).toEqual({ status: 'signedOut', user: null });
  });
});

describe('リダイレクトURL', () => {
  it('クエリとハッシュを取り除き、自ページのURLだけを返す', () => {
    expect(authRedirectUrl('https://arashi0-git.github.io/fantasy-sugoroku/?a=1#token')).toBe(
      'https://arashi0-git.github.io/fantasy-sugoroku/',
    );
    expect(authRedirectUrl('http://localhost:5173/#access_token=x')).toBe('http://localhost:5173/');
  });

  it('接続先は対象プロジェクトのURLである', () => {
    expect(SUPABASE_URL).toBe('https://azzyfumogyxkpzkmyzfo.supabase.co');
  });
});

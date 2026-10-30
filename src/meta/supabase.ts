// Supabase への接続設定（アカウント同期のクライアント基盤）。
// 接続情報はここ1か所にまとめ、他のモジュールは getSupabaseClient / createAuthService 経由で使う。
//
// 置いてあるのは Project URL と publishable key（旧 anon key）のみ。どちらもクライアントに
// 公開してよい前提の値で、安全はDB側の Row Level Security で担保する（設計仕様書 §8）。
// service_role key（RLSを無効化できる管理者キー）は絶対にここへ入れない・使わない。

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AuthService, type AuthApiLike } from './auth';
import type { ProfileStoreApi } from './sync';
import type { Profile } from './profile';

export const SUPABASE_URL = 'https://azzyfumogyxkpzkmyzfo.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_6Ykbas9s-R73K4HQQSlyDg_dMts45tI';

let client: SupabaseClient | null = null;

/** Supabase クライアント（単一インスタンス）。セッション管理は supabase-js の標準に任せる */
export function getSupabaseClient(): SupabaseClient {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  }
  return client;
}

/**
 * ログイン後に戻ってくるURL（自サイトのみ）。
 * 本番（GitHub Pages）でも開発サーバーでも動くよう、現在のページURLから
 * クエリとハッシュを除いたものを使う。他サイトへ飛ばす指定は構造上できない。
 */
export function authRedirectUrl(href: string = window.location.href): string {
  return href.split(/[?#]/)[0];
}

/** 認証の状態管理サービスを作る（接続先は上のクライアントに固定） */
export function createAuthService(): AuthService {
  // client.auth は AuthApiLike と構造的に互換だが、supabase-js 側の戻り値型が
  // 広いため、境界であるここで最小形へ寄せる
  const auth = getSupabaseClient().auth as unknown as AuthApiLike;
  return new AuthService(auth, () => authRedirectUrl());
}

/**
 * プロフィール保存API（profiles テーブルへの読み書き）の実体。
 * 生のSQLは送らず、PostgREST 経由のパラメータ化された操作だけを使う（§8）。
 * 到達できるのは RLS で「自分の1行」だけに限られる。
 */
export function createProfileStore(): ProfileStoreApi {
  const client = getSupabaseClient();
  return {
    async fetchOwnProfile(userId) {
      const { data, error } = await client
        .from('profiles')
        .select('data, updated_at')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const row = data as { data: unknown; updated_at: string };
      return { data: row.data, updatedAt: row.updated_at };
    },
    async upsertOwnProfile(userId, profile: Profile) {
      const { data, error } = await client
        .from('profiles')
        .upsert({ user_id: userId, data: profile }, { onConflict: 'user_id' })
        .select('updated_at')
        .single();
      if (error) throw error;
      const row = data as { updated_at: string };
      return { updatedAt: row.updated_at };
    },
  };
}

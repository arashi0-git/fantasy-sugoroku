# Supabase マイグレーション

アカウント同期（設計仕様書 `account-sync-design.md`）のためのDB定義を、SQLファイルとしてここで管理する。

## 適用方法

1. Supabase ダッシュボードで対象プロジェクトを開く
2. SQL Editor で `migrations/` のファイルをファイル名順に開き、内容を実行する
3. 実行後、Table Editor で `profiles` テーブルができていることと、RLS（Row Level Security）が有効なことを確認する

## ファイル

- `20261029000000_create_profiles.sql` — `profiles` テーブル（user_id / data JSONB / updated_at）と、「自分の行だけ読み書きできる」RLSポリシー、updated_at の自動更新トリガー

-- ファンタジーすごろく：profiles テーブル＋RLS（設計仕様書§4・§8）
-- フェーズ1 PRで supabase/migrations/ に配置し、ユーザーがSQL Editorで実行する想定の下書き。

create table public.profiles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- 自分の行だけ参照・作成・更新・削除できる（auth.uid() はログイン中ユーザーのID）
create policy "profiles_select_own"
  on public.profiles for select to authenticated
  using (auth.uid() = user_id);

create policy "profiles_insert_own"
  on public.profiles for insert to authenticated
  with check (auth.uid() = user_id);

create policy "profiles_update_own"
  on public.profiles for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "profiles_delete_own"
  on public.profiles for delete to authenticated
  using (auth.uid() = user_id);

-- updated_at を更新時に自動で進める
create or replace function public.touch_profiles_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_profiles_updated_at();

-- ============================================================================
-- Budget app — database schema, Row Level Security and private receipts storage.
-- Open sign-up: every user gets a fully isolated account (RLS + per-user storage folder).
-- Optional single-owner lock lives in supabase/signup_allowlist.sql (NOT used on the shared app).
-- Idempotent: safe to run more than once. Run as the project owner (SQL editor /
-- Management API). All tables are prefixed budget_ so they can also live next to
-- other apps in an existing project without clashing.
-- ============================================================================

-- ---------- 2. Tables --------------------------------------------------------
create table if not exists public.budget_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  kind text not null check (kind in ('income','expense')),
  color text not null default '#d4af6a' check (color ~ '^#[0-9a-fA-F]{6}$'),
  icon text not null default '•' check (char_length(icon) <= 8),
  monthly_budget numeric(12,2) check (monthly_budget is null or monthly_budget >= 0),
  sort int not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, kind, name)
);

create table if not exists public.budget_recurring (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('income','expense')),
  amount numeric(12,2) not null check (amount > 0 and amount < 100000000),
  category_id uuid,
  scope text not null default 'personal' check (scope in ('business','personal')),
  title text not null check (char_length(title) between 1 and 120),
  notes text check (char_length(notes) <= 2000),
  day_of_month int not null default 1 check (day_of_month between 1 and 31),
  start_month date not null default date_trunc('month', now())::date,
  end_month date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (category_id, user_id) references public.budget_categories(id, user_id) on delete set null (category_id)
);

-- v2: months in which a recurring item was deliberately skipped (its occurrence was deleted), 'YYYY-MM'
alter table public.budget_recurring add column if not exists skip_months text[] not null default '{}';
alter table public.budget_recurring drop constraint if exists budget_recurring_skip_months_chk;
alter table public.budget_recurring add constraint budget_recurring_skip_months_chk
  check (cardinality(skip_months) <= 600 and array_to_string(skip_months, ',') ~ '^([0-9]{4}-[0-9]{2}(,[0-9]{4}-[0-9]{2})*)?$');

create table if not exists public.budget_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('income','expense')),
  amount numeric(12,2) not null check (amount > 0 and amount < 100000000),
  date date not null default current_date,
  category_id uuid,
  scope text not null default 'personal' check (scope in ('business','personal')),
  title text check (char_length(title) <= 120),
  notes text check (char_length(notes) <= 2000),
  payment_method text check (char_length(payment_method) <= 30),
  receipt_path text check (receipt_path is null or split_part(receipt_path, '/', 1) = user_id::text),
  receipt_name text check (char_length(receipt_name) <= 200),
  receipt_type text check (char_length(receipt_type) <= 100),
  recurring_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (category_id, user_id) references public.budget_categories(id, user_id) on delete set null (category_id),
  foreign key (recurring_id, user_id) references public.budget_recurring(id, user_id) on delete set null (recurring_id),
  unique (user_id, recurring_id, date)  -- a recurring item is auto-added at most once per date, even from 2 devices
);
create index if not exists budget_tx_user_date on public.budget_transactions(user_id, date desc);

create table if not exists public.budget_settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb check (pg_column_size(data) < 65536),
  updated_at timestamptz not null default now()
);

create or replace function public.budget_touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists budget_tx_touch on public.budget_transactions;
create trigger budget_tx_touch before update on public.budget_transactions
  for each row execute function public.budget_touch_updated_at();

-- ---------- 3. Row Level Security: every row belongs to auth.uid() -----------
do $$
declare t text;
begin
  foreach t in array array['budget_categories','budget_recurring','budget_transactions','budget_settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists owner_select on public.%I', t);
    execute format('drop policy if exists owner_insert on public.%I', t);
    execute format('drop policy if exists owner_update on public.%I', t);
    execute format('drop policy if exists owner_delete on public.%I', t);
    execute format('create policy owner_select on public.%I for select to authenticated using (user_id = (select auth.uid()))', t);
    execute format('create policy owner_insert on public.%I for insert to authenticated with check (user_id = (select auth.uid()))', t);
    execute format('create policy owner_update on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('create policy owner_delete on public.%I for delete to authenticated using (user_id = (select auth.uid()))', t);
  end loop;
end $$;

-- ---------- 4. Private receipts bucket + per-user folder policies ------------
-- Files live at  <auth.uid()>/<transaction-id>/<file>.  Served via signed URLs only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('budget-receipts', 'budget-receipts', false, 15728640,
        array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf'])
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists budget_receipts_select on storage.objects;
drop policy if exists budget_receipts_insert on storage.objects;
drop policy if exists budget_receipts_update on storage.objects;
drop policy if exists budget_receipts_delete on storage.objects;
create policy budget_receipts_select on storage.objects for select to authenticated
  using (bucket_id = 'budget-receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy budget_receipts_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'budget-receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy budget_receipts_update on storage.objects for update to authenticated
  using (bucket_id = 'budget-receipts' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'budget-receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy budget_receipts_delete on storage.objects for delete to authenticated
  using (bucket_id = 'budget-receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);
notify pgrst, 'reload schema';

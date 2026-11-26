-- ============================================================================
-- v5: savings area. Two tables, same Row Level Security model as the rest (every row belongs to auth.uid()).
-- Idempotent and purely additive: safe to run more than once, touches no existing table or row.
-- Run:  node scripts/sql.mjs <project-ref> "$(cat supabase/savings.sql)"
-- ============================================================================

create table if not exists public.budget_savings_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  icon text not null default '🎯' check (char_length(icon) <= 8),
  color text not null default '#d4af6a' check (color ~ '^#[0-9a-fA-F]{6}$'),
  target_amount numeric(12,2) not null check (target_amount > 0 and target_amount < 100000000),
  target_date date,
  scope text check (scope is null or scope in ('business','personal')),   -- optional tag; null = general
  -- optional monthly automatic deposit (same idea as budget_recurring: one per month, never duplicated)
  auto_amount numeric(12,2) check (auto_amount is null or (auto_amount > 0 and auto_amount < 100000000)),
  auto_day int not null default 1 check (auto_day between 1 and 31),
  auto_start date,
  auto_skip text[] not null default '{}',                                  -- months whose automatic deposit was deleted on purpose, 'YYYY-MM'
  created_at timestamptz not null default now(),
  unique (id, user_id)
);
alter table public.budget_savings_goals drop constraint if exists budget_savings_goals_auto_skip_chk;
alter table public.budget_savings_goals add constraint budget_savings_goals_auto_skip_chk
  check (cardinality(auto_skip) <= 600 and array_to_string(auto_skip, ',') ~ '^([0-9]{4}-[0-9]{2}(,[0-9]{4}-[0-9]{2})*)?$');

create table if not exists public.budget_savings_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  goal_id uuid not null,
  kind text not null check (kind in ('deposit','withdrawal')),
  amount numeric(12,2) not null check (amount > 0 and amount < 100000000),
  date date not null default current_date,
  notes text check (char_length(notes) <= 500),
  auto_date date,                                                          -- set only on automatic monthly deposits
  created_at timestamptz not null default now(),
  foreign key (goal_id, user_id) references public.budget_savings_goals(id, user_id) on delete cascade,
  unique (user_id, goal_id, auto_date)                                     -- an automatic deposit is added at most once per date, even from 2 devices
);
create index if not exists budget_savings_entries_user_date on public.budget_savings_entries(user_id, date desc);

do $$
declare t text;
begin
  foreach t in array array['budget_savings_goals','budget_savings_entries'] loop
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
notify pgrst, 'reload schema';

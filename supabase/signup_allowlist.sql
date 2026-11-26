-- OPTIONAL: restrict sign-ups to listed emails (only for a private single-owner deployment).
-- ---------- 1. Sign-up allowlist (only Ziv may register) ---------------------
create schema if not exists budget_private;
revoke all on schema budget_private from public;

create table if not exists budget_private.allowed_emails (
  email text primary key check (email = lower(email))
);
insert into budget_private.allowed_emails(email) values ('studioimage1983@gmail.com')
  on conflict do nothing;

create or replace function budget_private.enforce_signup_allowlist()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.email is null
     or not exists (select 1 from budget_private.allowed_emails a where a.email = lower(new.email)) then
    raise exception 'Sign-ups are restricted for this app' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists budget_signup_allowlist on auth.users;
create trigger budget_signup_allowlist before insert on auth.users
  for each row execute function budget_private.enforce_signup_allowlist();


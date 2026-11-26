-- Minimal local stand-ins for Supabase's auth & storage schemas, so schema.sql
-- and its RLS can be tested on a plain Postgres. auth.uid() reads the JWT 'sub'
-- claim exactly like Supabase does.
create role anon nologin; create role authenticated nologin;
create schema auth; create schema storage;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create function auth.uid() returns uuid language sql stable as
 $$ select nullif(coalesce(current_setting('request.jwt.claim.sub', true),
     (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')), '')::uuid $$;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as
 $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'),1)-1] $$;
grant usage on schema public, auth, storage to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.buckets to authenticated;

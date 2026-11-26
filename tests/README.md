Local RLS suite: start a throw-away Postgres (e.g. `npm i @embedded-postgres/linux-x64`, `initdb`, `pg_ctl -o "-p 54329 -k /tmp" start`)
then `tests/run_rls_local.sh`. `supabase_stubs.sql` emulates Supabase's `auth.uid()` (JWT `sub` claim) and `storage.objects`.

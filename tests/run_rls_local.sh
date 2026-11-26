#!/bin/bash
# Spins a throw-away database on the local embedded Postgres and runs the RLS suite.
set -e
P="psql -h /tmp -p ${PGPORT:-54329} -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "drop database if exists budget_rls" -c "create database budget_rls"
$P -d budget_rls -f "$(dirname "$0")/supabase_stubs.sql"
$P -d budget_rls -f "$(dirname "$0")/../supabase/schema.sql"
$P -d budget_rls -f "$(dirname "$0")/../supabase/schema.sql"   # idempotency
$P -d budget_rls -f "$(dirname "$0")/../supabase/signup_allowlist.sql"
$P -d budget_rls -f "$(dirname "$0")/rls_test.sql"
# Open sign-up variant (the shared app): no allowlist, a stranger registers freely but stays isolated.
$P -c "drop database if exists budget_rls_open" -c "create database budget_rls_open"
$P -d budget_rls_open -f "$(dirname "$0")/supabase_stubs.sql"
$P -d budget_rls_open -f "$(dirname "$0")/../supabase/schema.sql"
python3 - "$(dirname "$0")/rls_test.sql" > /tmp/rls_open_test.sql <<'PY'
import sys; s=open(sys.argv[1]).read()
a=s.index('do $$ begin'); b=s.index("insert into auth.users(id,email) values ('11111111")
s=s[:a]+s[b:]
s=s.replace("alter table auth.users disable trigger budget_signup_allowlist;\n","").replace("alter table auth.users enable trigger budget_signup_allowlist;\n","")
s=s.replace("insert into auth.users(id,email) values ('22222222-2222-2222-2222-222222222222','intruder@example.com');","insert into auth.users(id,email) values ('22222222-2222-2222-2222-222222222222','stranger@example.com'); do $x$ begin raise notice 'PASS: open sign-up accepted a stranger'; end $x$;")
print(s)
PY
$P -d budget_rls_open -f /tmp/rls_open_test.sql

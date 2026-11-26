#!/bin/bash
# Spins a throw-away database on the local embedded Postgres and runs the RLS suite.
set -e
P="psql -h /tmp -p ${PGPORT:-54329} -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "drop database if exists budget_rls" -c "create database budget_rls"
$P -d budget_rls -f "$(dirname "$0")/supabase_stubs.sql"
$P -d budget_rls -f "$(dirname "$0")/../supabase/schema.sql"
$P -d budget_rls -f "$(dirname "$0")/../supabase/schema.sql"   # idempotency
$P -d budget_rls -f "$(dirname "$0")/rls_test.sql"

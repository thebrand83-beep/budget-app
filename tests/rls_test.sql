\set ON_ERROR_STOP 1
-- Two users: Ziv (allowlisted) and an intruder inserted by bypassing the trigger as superuser.
do $$ begin
  begin
    insert into auth.users(id,email) values ('22222222-2222-2222-2222-222222222222','intruder@example.com');
    raise exception 'FAIL: allowlist let a stranger sign up';
  exception when insufficient_privilege then raise notice 'PASS: stranger sign-up blocked by allowlist';
  end;
end $$;
insert into auth.users(id,email) values ('11111111-1111-1111-1111-111111111111','StudioImage1983@gmail.com');
alter table auth.users disable trigger budget_signup_allowlist;
insert into auth.users(id,email) values ('22222222-2222-2222-2222-222222222222','intruder@example.com');
alter table auth.users enable trigger budget_signup_allowlist;

-- as Ziv
set role authenticated; set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
insert into budget_categories(id,name,kind) values ('aaaaaaaa-0000-0000-0000-000000000001','צילום','income');
insert into budget_recurring(id,kind,amount,title) values ('bbbbbbbb-0000-0000-0000-000000000001','expense',3200,'שכירות סטודיו');
insert into budget_transactions(kind,amount,category_id,scope,title,receipt_path)
  values ('income',1800,'aaaaaaaa-0000-0000-0000-000000000001','business','חתונה','11111111-1111-1111-1111-111111111111/x/receipt.jpg');
insert into budget_transactions(kind,amount,date,recurring_id,title) values ('expense',3200,'2026-11-01','bbbbbbbb-0000-0000-0000-000000000001','שכירות');
insert into budget_transactions(kind,amount,date,recurring_id,title) values ('expense',3200,'2026-11-01','bbbbbbbb-0000-0000-0000-000000000001','שכירות') on conflict do nothing;
insert into storage.objects(bucket_id,name) values ('budget-receipts','11111111-1111-1111-1111-111111111111/x/receipt.jpg');
select 'ziv sees tx', count(*) from budget_transactions;

-- as intruder
set request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
do $$ declare n int; begin
  select count(*) into n from budget_transactions; if n<>0 then raise exception 'FAIL tx visible %',n; end if;
  select count(*) into n from budget_categories; if n<>0 then raise exception 'FAIL cat visible'; end if;
  select count(*) into n from budget_recurring; if n<>0 then raise exception 'FAIL rec visible'; end if;
  select count(*) into n from storage.objects; if n<>0 then raise exception 'FAIL receipt visible'; end if;
  update budget_transactions set amount=1; get diagnostics n = row_count; if n<>0 then raise exception 'FAIL update'; end if;
  delete from budget_transactions; get diagnostics n = row_count; if n<>0 then raise exception 'FAIL delete'; end if;
  delete from storage.objects; get diagnostics n = row_count; if n<>0 then raise exception 'FAIL storage delete'; end if;
  begin insert into budget_transactions(user_id,kind,amount) values ('11111111-1111-1111-1111-111111111111','expense',5); raise exception 'FAIL insert as other';
  exception when insufficient_privilege then null; end;
  begin insert into storage.objects(bucket_id,name) values ('budget-receipts','11111111-1111-1111-1111-111111111111/evil.jpg'); raise exception 'FAIL storage insert into other folder';
  exception when insufficient_privilege then null; end;
  begin insert into budget_transactions(kind,amount,category_id) values ('expense',5,'aaaaaaaa-0000-0000-0000-000000000001'); raise exception 'FAIL cross-user category link';
  exception when foreign_key_violation then null; end;
  begin insert into budget_transactions(kind,amount,receipt_path) values ('expense',5,'11111111-1111-1111-1111-111111111111/a.jpg'); raise exception 'FAIL foreign receipt path';
  exception when check_violation then null; end;
  raise notice 'PASS: intruder sees 0 rows, cannot update/delete/insert into Ziv data or receipts';
end $$;

-- anon
set role anon; set request.jwt.claims = '{"role":"anon"}';
do $$ begin
  begin perform count(*) from budget_transactions; raise exception 'FAIL anon read';
  exception when insufficient_privilege then raise notice 'PASS: anon has no access'; end;
end $$;
reset role;
select 'ziv rows after attacks', count(*), sum(amount) from budget_transactions;

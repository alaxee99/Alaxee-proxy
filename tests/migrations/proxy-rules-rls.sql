do $$
declare
  v_columns text[];
  v_rls_enabled boolean;
  v_security_definer boolean;
begin
  select array_agg(column_name order by ordinal_position)
    into v_columns
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'proxy_domain_rules';

  if v_columns is distinct from array[
    'user_id', 'host', 'rule_type', 'include_subdomains',
    'is_deleted', 'revision', 'updated_at'
  ]::text[] then
    raise exception 'Unexpected Proxy rule columns: %', v_columns;
  end if;

  select c.relrowsecurity
    into v_rls_enabled
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'proxy_domain_rules';

  if v_rls_enabled is distinct from true then
    raise exception 'RLS is not enabled on proxy_domain_rules';
  end if;

  if has_table_privilege('anon', 'public.proxy_domain_rules', 'SELECT')
     or has_table_privilege('anon', 'public.proxy_domain_rules', 'INSERT')
     or has_table_privilege('anon', 'public.proxy_domain_rules', 'UPDATE') then
    raise exception 'anon unexpectedly has access to proxy_domain_rules';
  end if;

  if not has_table_privilege('authenticated', 'public.proxy_domain_rules', 'SELECT')
     or not has_table_privilege('authenticated', 'public.proxy_domain_rules', 'INSERT')
     or not has_table_privilege('authenticated', 'public.proxy_domain_rules', 'UPDATE')
     or has_table_privilege('authenticated', 'public.proxy_domain_rules', 'DELETE') then
    raise exception 'authenticated table grants do not match SELECT/INSERT/UPDATE only';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'proxy_domain_rules'
      and cmd = 'SELECT'
      and roles @> array['authenticated']::name[]
  ) or not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'proxy_domain_rules'
      and cmd = 'INSERT'
      and roles @> array['authenticated']::name[]
  ) or not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'proxy_domain_rules'
      and cmd = 'UPDATE'
      and roles @> array['authenticated']::name[]
      and qual is not null
      and with_check is not null
  ) then
    raise exception 'Required owner-scoped RLS policies are missing';
  end if;

  select p.prosecdef
    into v_security_definer
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'set_proxy_domain_rules_server_fields';

  if v_security_definer is distinct from false then
    raise exception 'Revision trigger function must remain SECURITY INVOKER';
  end if;
end
$$;

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

do $$
declare
  v_row public.proxy_domain_rules%rowtype;
begin
  insert into public.proxy_domain_rules (
    host, rule_type, include_subdomains, revision, updated_at
  ) values (
    'example.com', 'whitelist', true, 999, '2000-01-01T00:00:00Z'
  );

  select * into v_row
  from public.proxy_domain_rules
  where host = 'example.com';

  if v_row.user_id <> auth.uid() or v_row.revision <> 1
     or v_row.updated_at <= '2000-01-01T00:00:00Z'::timestamptz then
    raise exception 'Server did not set owner, revision 1 and updated_at on insert: %', row_to_json(v_row);
  end if;

  update public.proxy_domain_rules
  set rule_type = 'blacklist',
      revision = 999,
      updated_at = '2000-01-01T00:00:00Z',
      include_subdomains = false
  where host = 'example.com';

  select * into v_row
  from public.proxy_domain_rules
  where host = 'example.com';

  if v_row.rule_type <> 'blacklist' or v_row.revision <> 2
     or v_row.updated_at <= '2000-01-01T00:00:00Z'::timestamptz then
    raise exception 'Server did not increment revision/update timestamp: %', row_to_json(v_row);
  end if;

  begin
    update public.proxy_domain_rules
    set user_id = '22222222-2222-4222-8222-222222222222'
    where host = 'example.com';
    raise exception 'Ownership reassignment unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.proxy_domain_rules (user_id, host, rule_type)
    values ('22222222-2222-4222-8222-222222222222', 'spoof.example', 'whitelist');
    raise exception 'Cross-user insert unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;

  insert into public.proxy_domain_rules (host, rule_type)
  values ('[2001:db8::1]', 'whitelist');

  begin
    insert into public.proxy_domain_rules (host, rule_type)
    values ('bad..example', 'whitelist');
    raise exception 'Malformed hostname unexpectedly passed the constraint';
  exception when check_violation then
    null;
  end;

  update public.proxy_domain_rules
  set is_deleted = true
  where host = 'example.com';

  select * into v_row
  from public.proxy_domain_rules
  where host = 'example.com';

  if v_row.is_deleted is distinct from true or v_row.revision <> 3 then
    raise exception 'Tombstone write did not increment revision: %', row_to_json(v_row);
  end if;

  begin
    delete from public.proxy_domain_rules where host = 'example.com';
    raise exception 'DELETE unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;
end
$$;

set request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';

do $$
begin
  if exists (select 1 from public.proxy_domain_rules) then
    raise exception 'A different user can read another user''s domain rules';
  end if;

  if exists (
    update public.proxy_domain_rules
    set include_subdomains = true
    where host = 'example.com'
    returning 1
  ) then
    raise exception 'A different user updated another user''s domain rule';
  end if;
end
$$;

reset role;

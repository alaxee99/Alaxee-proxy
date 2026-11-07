-- Dedicated cloud storage for Proxy domain allow/force-proxy rules.
-- Proxy endpoints, ports, schemes, and active browser proxy mode stay local.

create table public.proxy_domain_rules (
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  host text not null,
  rule_type text not null
    check (rule_type in ('whitelist', 'blacklist')),
  include_subdomains boolean not null default true,
  is_deleted boolean not null default false,
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  constraint proxy_domain_rules_pkey primary key (user_id, host),
  constraint proxy_domain_rules_host_normalized check (
    host = lower(host)
    and length(host) between 1 and 253
    and (
      host ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?([.][a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$'
      or host ~ '^(left(host, 1) = '[' and right(host, 1) = ']' and position(':' in host) > 0 and substring(host from 2 for length(host) - 2) ~ '^[0-9a-f:.]+$'
    )
  )
);

comment on table public.proxy_domain_rules is
  'User-owned ALAXEE Proxy domain rules. Proxy endpoints and browser mode remain device-local.';
comment on column public.proxy_domain_rules.is_deleted is
  'Tombstone used by multi-device sync; clients must not issue DELETE.';
comment on column public.proxy_domain_rules.revision is
  'Server-controlled optimistic concurrency revision.';

create index proxy_domain_rules_user_updated_idx
  on public.proxy_domain_rules (user_id, updated_at, host);

alter table public.proxy_domain_rules enable row level security;

revoke all on table public.proxy_domain_rules from public, anon, authenticated;
grant select, insert, update on table public.proxy_domain_rules to authenticated;

create policy "Users can read their own Proxy domain rules"
  on public.proxy_domain_rules
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert their own Proxy domain rules"
  on public.proxy_domain_rules
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own Proxy domain rules"
  on public.proxy_domain_rules
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create or replace function public.set_proxy_domain_rules_server_fields()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT' then
    new.revision := 1;
  else
    new.revision := old.revision + 1;
  end if;
  new.updated_at := pg_catalog.now();
  return new;
end;
$function$;

revoke all on function public.set_proxy_domain_rules_server_fields()
  from public, anon, authenticated;

create trigger proxy_domain_rules_server_fields
  before insert or update on public.proxy_domain_rules
  for each row
  execute function public.set_proxy_domain_rules_server_fields();
)$'
    )
  )
);

comment on table public.proxy_domain_rules is
  'User-owned ALAXEE Proxy domain rules. Proxy endpoints and browser mode remain device-local.';
comment on column public.proxy_domain_rules.is_deleted is
  'Tombstone used by multi-device sync; clients must not issue DELETE.';
comment on column public.proxy_domain_rules.revision is
  'Server-controlled optimistic concurrency revision.';

create index proxy_domain_rules_user_updated_idx
  on public.proxy_domain_rules (user_id, updated_at, host);

alter table public.proxy_domain_rules enable row level security;

revoke all on table public.proxy_domain_rules from public, anon, authenticated;
grant select, insert, update on table public.proxy_domain_rules to authenticated;

create policy "Users can read their own Proxy domain rules"
  on public.proxy_domain_rules
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert their own Proxy domain rules"
  on public.proxy_domain_rules
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own Proxy domain rules"
  on public.proxy_domain_rules
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create or replace function public.set_proxy_domain_rules_server_fields()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT' then
    new.revision := 1;
  else
    new.revision := old.revision + 1;
  end if;
  new.updated_at := pg_catalog.now();
  return new;
end;
$function$;

revoke all on function public.set_proxy_domain_rules_server_fields()
  from public, anon, authenticated;

create trigger proxy_domain_rules_server_fields
  before insert or update on public.proxy_domain_rules
  for each row
  execute function public.set_proxy_domain_rules_server_fields();

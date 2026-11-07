do $$
begin
  create role anon nologin;
exception when duplicate_object then
  null;
end
$$;

do $$
begin
  create role authenticated nologin;
exception when duplicate_object then
  null;
end
$$;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $function$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$function$;

grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;

insert into auth.users (id)
values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222')
on conflict (id) do nothing;

#!/usr/bin/env bash
set -euo pipefail

if [[ -z "\${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required for isolated Proxy migration tests." >&2
  exit 1
fi

shopt -s nullglob
migrations=(supabase/migrations/*_add_proxy_domain_rules.sql)
if [[ \${#migrations[@]} -ne 1 ]]; then
  echo "Expected exactly one add_proxy_domain_rules migration; found \${#migrations[@]}." >&2
  exit 1
fi

psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f tests/migrations/proxy-rules-bootstrap.sql
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "\${migrations[0]}"
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f tests/migrations/proxy-rules-rls.sql

echo "Proxy migration checks passed: schema, grants, RLS isolation, ownership, revision trigger, tombstones and DELETE denial."

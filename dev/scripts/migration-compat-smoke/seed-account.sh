#!/usr/bin/env bash
# Seeds the verified credential account the smoke signs in with, as main's
# platform/app/e2e/langy/seed-account.ts does: registration wants an emailed
# proof a CI job cannot read. The bcrypt hash is made in the "postgres"
# database, so head's schema gains no extension. Usage: seed-account.sh EMAIL PASSWORD
set -euo pipefail

email="${1:?email}"
password="${2:?password}"
: "${DATABASE_URL:?names the migrated head database}"

database_url="${DATABASE_URL%%\?*}"
admin_url="${database_url%/*}/postgres"

psql "$admin_url" -qtA -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS pgcrypto" >/dev/null
hash="$(psql "$admin_url" -qtA -v ON_ERROR_STOP=1 -v pw="$password" <<'SQL'
SELECT crypt(:'pw', gen_salt('bf', 10));
SQL
)"
# node's bcrypt writes $2b$; the two prefixes name the same algorithm.
hash="\$2b\$${hash#\$2a\$}"

user_id="compat_$(openssl rand -hex 10)"
account_id="compat_$(openssl rand -hex 10)"
psql "$database_url" -q -1 -v ON_ERROR_STOP=1 \
  -v uid="$user_id" -v aid="$account_id" -v email="$email" -v hash="$hash" <<'SQL'
INSERT INTO "User" (id, name, email, "emailVerified") VALUES (:'uid', 'Compat smoke', :'email', true);
INSERT INTO "Account" (id, "userId", type, provider, issuer, "providerAccountId", password)
VALUES (:'aid', :'uid', 'credentials', 'credential', 'local:credential', :'uid', :'hash');
SQL
echo "seeded ${email} as ${user_id}"

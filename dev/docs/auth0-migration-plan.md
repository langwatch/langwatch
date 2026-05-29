# Auth0 → Direct OIDC Migration Plan

> **Status:** Plan documented — NOT executed. Requires human review and coordination.
> **Risk level:** HIGH — irreversible data migration affecting all enterprise SSO customers.
> **Prerequisite:** Phase 2 SsoConnection model must be deployed and stable first.

---

## Overview

Auth0 currently acts as an OIDC middleman between enterprise IdPs (Okta, Azure AD, Google Workspace) and BetterAuth. Removing it requires:

1. Switching BetterAuth from `genericOAuth(auth0)` to direct provider configs
2. Migrating `Account.provider` data from `"auth0"` to actual provider names
3. Migrating `Organization.ssoProvider` from Auth0 connection prefixes to direct provider names
4. Importing Auth0 password hashes for users with credential accounts
5. Removing Auth0-specific code

---

## Step 1: Pre-Migration Audit (non-destructive)

Run these queries to understand the blast radius:

```sql
-- Count accounts by provider
SELECT provider, COUNT(*) FROM "Account" GROUP BY provider;

-- Count accounts with auth0 provider, grouped by providerAccountId prefix
SELECT
  SPLIT_PART("providerAccountId", '|', 1) AS idp_prefix,
  COUNT(*)
FROM "Account"
WHERE provider = 'auth0'
GROUP BY idp_prefix;

-- Count orgs with ssoProvider set
SELECT "ssoProvider", COUNT(*) FROM "Organization"
WHERE "ssoProvider" IS NOT NULL
GROUP BY "ssoProvider";

-- Count users with credential accounts (password hashes in Auth0)
SELECT COUNT(*) FROM "Account" WHERE provider = 'credential';
```

---

## Step 2: Auth0 Password Hash Export

**When:** Before cutting over, export password hashes from Auth0.

```bash
# Auth0 Management API: Export users with password hashes
# Requires "read:users" scope on M2M application
curl -X POST "https://${AUTH0_DOMAIN}/api/v2/jobs/users-exports" \
  -H "Authorization: Bearer ${AUTH0_MGMT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "format": "json",
    "fields": [
      {"name": "user_id"},
      {"name": "email"},
      {"name": "password_hash", "export_as": "password_hash"}
    ]
  }'
```

**Risk:** Auth0 uses bcrypt for password hashes. BetterAuth also uses bcrypt — hashes are directly compatible. Import via:

```sql
-- For each exported user with a password hash:
-- 1. Find the user by email
-- 2. Create or update their credential Account row with the bcrypt hash
UPDATE "Account"
SET "password" = $hash
WHERE "userId" = $userId AND provider = 'credential';
```

---

## Step 3: Data Migration — Account.provider

Map Auth0 providerAccountId prefixes to direct provider names:

```sql
-- Google via Auth0: "google-oauth2|12345..." → provider="google", providerAccountId="12345..."
UPDATE "Account"
SET provider = 'google',
    "providerAccountId" = SUBSTRING("providerAccountId" FROM POSITION('|' IN "providerAccountId") + 1)
WHERE provider = 'auth0'
  AND "providerAccountId" LIKE 'google-oauth2|%';

-- Azure AD via Auth0: "waad|connection|user-id" → provider="microsoft", providerAccountId="user-id"
-- NOTE: Azure AD providerAccountId has TWO pipes: waad|connection-name|actual-user-id
-- The actual user ID is the part after the SECOND pipe
UPDATE "Account"
SET provider = 'microsoft',
    "providerAccountId" = SUBSTRING("providerAccountId" FROM LENGTH(SPLIT_PART("providerAccountId", '|', 1)) + LENGTH(SPLIT_PART("providerAccountId", '|', 2)) + 3)
WHERE provider = 'auth0'
  AND "providerAccountId" LIKE 'waad|%';

-- Okta via Auth0: "okta|org_id|user_id" → provider="okta", providerAccountId="user_id"
UPDATE "Account"
SET provider = 'okta',
    "providerAccountId" = SUBSTRING("providerAccountId" FROM LENGTH(SPLIT_PART("providerAccountId", '|', 1)) + LENGTH(SPLIT_PART("providerAccountId", '|', 2)) + 3)
WHERE provider = 'auth0'
  AND "providerAccountId" LIKE 'okta|%';
```

**Risk:** If any `providerAccountId` doesn't match expected patterns, the user loses SSO access. Run the audit query from Step 1 first to identify edge cases.

**Rollback:** Keep a backup table before migration:
```sql
CREATE TABLE "Account_auth0_backup" AS
SELECT id, provider, "providerAccountId" FROM "Account" WHERE provider = 'auth0';
```

---

## Step 4: Data Migration — Organization.ssoProvider

```sql
-- Map Auth0 connection prefixes to direct provider names
UPDATE "Organization"
SET "ssoProvider" = 'microsoft'
WHERE "ssoProvider" LIKE 'waad|%';

UPDATE "Organization"
SET "ssoProvider" = 'okta'
WHERE "ssoProvider" LIKE 'okta|%';

UPDATE "Organization"
SET "ssoProvider" = 'google'
WHERE "ssoProvider" = 'google-oauth2';
```

**Rollback:**
```sql
CREATE TABLE "Organization_sso_backup" AS
SELECT id, "ssoProvider" FROM "Organization" WHERE "ssoProvider" IS NOT NULL;
```

---

## Step 5: Environment Variable Switch

Change cloud deployment config:

```bash
# Before
NEXTAUTH_PROVIDER=auth0
AUTH0_CLIENT_ID=xxx
AUTH0_CLIENT_SECRET=xxx
AUTH0_ISSUER=https://tenant.us.auth0.com/

# After (per-customer, depends on their IdP)
# For orgs using Azure AD:
NEXTAUTH_PROVIDER=azure-ad
AZURE_AD_CLIENT_ID=xxx
AZURE_AD_CLIENT_SECRET=xxx
AZURE_AD_TENANT_ID=xxx

# For orgs using Okta:
NEXTAUTH_PROVIDER=okta
OKTA_CLIENT_ID=xxx
OKTA_CLIENT_SECRET=xxx
OKTA_ISSUER=https://dev-xxx.okta.com
```

**Important:** This step is BLOCKED until Phase 2 SsoConnection is live. With SsoConnection, per-org provider config is stored in DB, not env vars. The env var switch only applies to the global default provider for non-SSO-configured orgs.

---

## Step 6: Code Removal

After migration is confirmed stable (min 2 weeks monitoring):

1. **Delete:** `src/server/auth0/passwordService.ts` — Auth0 Management API password ops
2. **Delete:** Auth0 SCIM webhook handler in `src/server/routes/webhooks.ts`
3. **Delete:** Auth0 federated logout in `src/server/routes/auth.ts` lines 133-145
4. **Update:** `src/server/better-auth/sso.ts` — remove Auth0 `providerAccountId` prefix matching from `isSsoProviderMatch()`
5. **Update:** `src/server/better-auth/index.ts` — remove Auth0 genericOAuth config block (lines 136-168)
6. **Remove:** Auth0 env vars from `.env.example` and deployment configs

---

## Rollback Plan

1. **Immediate (< 1 hour):** Restore env vars to `NEXTAUTH_PROVIDER=auth0`, redeploy
2. **Data rollback:** Restore from backup tables created in Steps 3-4
3. **Full rollback:** Revert code changes, restore env vars, restore data

---

## Checklist for Human Execution

- [ ] Run Step 1 audit queries, review results
- [ ] Export Auth0 password hashes (Step 2)
- [ ] Create backup tables (Steps 3-4 rollback sections)
- [ ] Run Account.provider migration in staging
- [ ] Run Organization.ssoProvider migration in staging
- [ ] Test SSO login for each provider type in staging
- [ ] Schedule maintenance window for production
- [ ] Run migrations in production
- [ ] Switch env vars
- [ ] Monitor error rates for 24 hours
- [ ] After 2 weeks stable: execute Step 6 code removal

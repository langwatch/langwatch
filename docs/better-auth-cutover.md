# BetterAuth cutover — deployment notes

This document describes how the NextAuth → BetterAuth migration ships and
what happens on deploy day.

## TL;DR

- Every currently-logged-in user will be **logged out** when the deploy
  finishes. They'll need to sign in again on their next visit.
- There is **no data loss**: User, Account, Organization, and membership
  rows are preserved. Only the `Session` table is truncated.
- Credentials (bcrypt) passwords keep working unchanged — legacy hashes
  verify via a custom `password.verify` that delegates to bcrypt.
- SSO, Auth0, Azure AD, GitHub, GitLab, Okta, Google — all providers
  ported with fallback profile mappers so missing-name edge cases don't
  fail signup.
- Admin impersonation works exactly as before via the existing
  `Session.impersonating` JSON column.
- Session TTL is **30 days** (matches the old NextAuth `maxAge`).

## Deploy sequence

The migration ships as a single PR. During deploy:

1. **Migrations run first** (before the new app version boots):
   - `20260410230000_better_auth_additive` — ADD COLUMN IF NOT EXISTS for
     `Account.password`, `Session.ipAddress/userAgent/createdAt/updatedAt`,
     `VerificationToken.id/createdAt/updatedAt`. Idempotent, reversible.
   - `20260410233000_better_auth_destructive` — **DESTRUCTIVE**:
     - INSERTs credential `Account` rows for every `User` with a password
     - DROPs `User.password`
     - TRUNCATEs `Session`
     - ALTERs `User.emailVerified` from `DateTime?` to `Boolean`
2. **App container restarts** with the BetterAuth-backed code.
3. Users on existing NextAuth sessions hit any page → their old
   `next-auth.session-token` cookie is not recognized by BetterAuth →
   `useRequiredSession` sees no session → redirects them to `/auth/signin`.
4. They sign in again. Auth0 users bounce through Auth0 once. Credential
   users re-enter their password. **All accounts keep working.**

## What to tell users

> "We're rolling out an auth upgrade. You'll be signed out briefly and
> asked to sign in again. Your account, organizations, and data are all
> preserved. If you use Auth0 SSO, just click 'Sign in' and you'll bounce
> through Auth0 as normal. If you use email+password, your password is
> unchanged."

## Rollback

If the deploy goes sideways **before** the destructive migration runs,
rollback is a simple code revert + restart. Nothing has changed in the
database yet.

If the deploy goes sideways **after** the destructive migration runs,
rollback requires a data restore. The destructive migration dropped
`User.password`, truncated `Session`, and changed `User.emailVerified`'s
column type — none of those are trivially reversible from the running
state. The correct rollback is a PITR-style DB restore to just before
the migration applied.

**Recommendation**: snapshot the production DB immediately before
`prisma migrate deploy` runs. Keep the snapshot for at least 24 hours.

## What could still break at deploy time

1. **Prod has pgcrypto extension**: the migration's `md5(random()::text)`
   fallback was introduced specifically because fresh Postgres containers
   and some on-prem installs lack `pgcrypto`. AWS RDS has it, but the
   migration doesn't rely on it — no concern.
2. **Fresh pods reading `Session` rows created by old pods**: impossible
   because `TRUNCATE Session` runs first. Post-deploy, only new sessions
   exist and they're created by the new code.
3. **Existing OAuth `Account` rows with unexpected column values**: the
   additive migration renames no columns. Existing snake_case fields
   (`access_token`, `refresh_token`, etc.) are mapped in BetterAuth's
   config via `account.fields`, so the data stays put. Verified via
   end-to-end smoketest against a live Postgres.
4. **Users with `User.name` as null**: BetterAuth's Zod schema requires
   `name: string` (non-nullable). Existing users with null `name` can
   still authenticate because BetterAuth only validates on create/update,
   not on read. New signups via OAuth go through the `fallbackName`
   helper which chains through nickname → login → username → email prefix
   → literal `"User"`. Verified via unit tests.

## On-prem upgrade path

Self-hosted deployments run the same migration. Key differences:

- **No Redis**: rate limiting falls back to in-memory via
  `rateLimit.storage: "memory"`. Single-pod on-prem works fine; multi-pod
  on-prem will have per-pod rate limit windows (acceptable for the
  credential stuffing threat model).
- **Credentials only**: `NEXTAUTH_PROVIDER=email` means no social
  providers are registered, the signin page shows only the email+password
  form, and SSO hooks are inactive.
- **Bcrypt hashes**: preserved. Users keep their existing passwords.

## Post-deploy verification checklist

Run this in order on prod:

1. `GET /api/auth/session` on an unauthenticated request → returns null/empty
2. `POST /api/auth/sign-in/email` with valid creds → 200 + `Set-Cookie: better-auth.session_token=...`
3. Same request, check cookie flags: `HttpOnly`, `Secure` (HTTPS), `SameSite=Lax`, `Path=/`
4. `GET /api/auth/session` with the cookie → returns the user
5. Open `/settings` → loads without redirect loop
6. Open `/admin` (as admin) → admin panel loads
7. Trigger impersonation → session shows impersonated user + `impersonator` field populated
8. Sign out → session_token cookie cleared
9. For orgs with SSO: test Auth0 callback → new user gets `pendingSsoSetup: false` and correct org membership
10. For orgs with SSO: test wrong-provider → existing user gets the "link your SSO" banner but isn't blocked

## If something goes wrong

- **Users can't sign in**: check `langwatch/server.log` for `langwatch:better-auth` errors. Likely culprits: missing env vars (`NEXTAUTH_SECRET`, provider client secrets), or the bcrypt verify failing.
- **Sessions not persisting**: check `Session` table for rows. If rows exist but `auth.api.getSession` returns null, the cookie is likely being blocked by SameSite/Secure in a non-HTTPS environment.
- **OAuth callback errors**: the migration preserves the legacy NextAuth callback paths via a Next.js rewrite + a `redirectURI` override on the genericOAuth providers (auth0/okta). Existing customer applications in Auth0/Okta should continue to work without updating their allowed callbacks. If errors persist, double-check that the customer's IdP has `${NEXTAUTH_URL}/api/auth/callback/{provider}` (NOT `/api/auth/oauth2/callback/{provider}`) in its allowed redirect URI list — that's the path we pin to.
- **Admin impersonation broken**: verify the legacy `Session.impersonating` JSON column is still present — it's preserved by the migration but worth double-checking in prod.
- **SSO domain auto-add silently not firing**: BetterAuth lowercases emails on signup/signin, so the `extractEmailDomain` runtime lookup always queries with lowercase. If `Organization.ssoDomain` was stored with mixed case (e.g. "ACME.COM") before the iter-30 fix, the lookup won't match. One-time fix: `UPDATE "Organization" SET "ssoDomain" = LOWER("ssoDomain") WHERE "ssoDomain" IS NOT NULL;`. The iter-30 fix in `src/pages/api/admin/[resource].ts` ensures future admin writes are normalized.

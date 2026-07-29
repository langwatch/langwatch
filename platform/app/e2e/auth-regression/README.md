# `e2e/auth-regression/`

Manual/standalone regression scripts for the NextAuth → BetterAuth
migration audit. These are **not** part of `pnpm test:e2e` because
they use a different architecture from the happy-path Playwright
suite (they don't use `@playwright/test`'s test runner, don't rely on
a prebuilt `auth.json`, and they talk directly to Postgres + Redis
to set up and tear down their own fixtures).

They sit here — under `e2e/` — because they are end-to-end tests in
spirit (real dev server, real DB, real Redis, real Chromium) even if
the runner is a plain `tsx` script.

## Why not use the `@playwright/test` framework?

Two practical reasons:

1. **Fast dev loop.** During the 49-iteration audit, having a
   long-running dev server on port 5571 plus tiny `tsx` scripts that
   talk to it directly was ~5× faster than the full Playwright test
   runner's cold start + fixture wiring for each suite.
2. **Dynamic DB setup.** Each script creates and cleans up its own
   users/orgs/sessions directly via Prisma. `@playwright/test` wants
   you to do that through `beforeEach`/`globalSetup`, which is fine
   for happy paths but awkward for the "create two sessions, revoke
   one, verify the other is dead" kinds of flows the audit needed.

If you want to convert any of these to proper `*.spec.ts` files for
CI, go ahead — the underlying assertions port cleanly. But keep them
out of the default `test:e2e` run since they need a preconfigured
isolated Postgres + Redis (not the shared dev DB).

## Two categories

### 1. HTTP smoketest scripts (no browser)

Standalone `tsx` scripts that hit the BetterAuth server-side API
directly via `auth.api.*` and check state via Prisma. No Chromium.
Fast. Use these when you need to verify the server logic end-to-end
without any UI concerns:

- `better-auth-smoketest.ts` — 39 checks: signup, signin, signout,
  wrong-password, deactivated-user, session lookup, lastLoginAt,
  impersonation, legacy bcrypt, SCIM, session TTL, etc.
- `better-auth-sso-smoketest.ts` — 11 checks: SSO hook integration
  (auto-add, provider match, WAAD prefix, stale account cleanup,
  etc.)
- `better-auth-compat-smoketest.ts` — 20 checks: the `getServerAuthSession`
  compat layer with real cookies + real impersonation.

### 2. Browser regression scripts (real Chromium via Playwright)

Standalone `tsx` scripts that drive a real headless Chromium against
a running dev server. Each one corresponds to an iteration of the
ralph audit and exercises a specific bug class:

| Script | What it verifies |
|--------|------------------|
| `iter43-browser-qa.ts` | Basic signup / signin / signout / error page (17 checks) |
| `iter44-browser-flows.ts` | Onboarding redirect, invitation link, settings page, wrong-email invite (10 checks) |
| `iter45-change-password-flow.ts` | Change-password → `revokeOtherSessions` wiring with TWO browser contexts (18 checks) |
| `iter45-csrf-browser.ts` | Cross-site form POST from `evil.localhost` blocked by `formCsrfMiddleware` (5 checks) |
| `iter46-bug30-31-fixes.ts` | tRPC rate limit + same-origin gate (10 checks) |
| `iter47-invite-edge-cases.ts` | Already-signed-in accept / already-accepted / expired / case-insensitive / unauth (10 checks) |
| `iter49-bug36-changepw-rate-limit.ts` | Per-user rate limit on `user.changePassword` brute-force (4 checks) |
| `iter49-bug37-unlink-race.ts` | `unlinkAccount` TOCTOU race (serializable tx) (4 checks) |

## Prerequisites

1. **Isolated Postgres.** A throwaway Postgres at `localhost:5434`
   with user `langwatch_db` / password `smoketest` / schema `langwatch_db`.
   Never run these against the shared dev DB — the safety guard in
   `_smoketest-guard.ts` parses `DATABASE_URL` and rejects anything
   that isn't on an explicit localhost allowlist, but belt-and-suspenders.
2. **Redis** on `localhost:6379` (or set `SKIP_REDIS=1` — the scripts
   fall back to in-memory rate limiting).
3. **Dev server** running on `localhost:5571`:
   ```sh
   DATABASE_URL="postgresql://langwatch_db:smoketest@localhost:5434/langwatch_db?schema=langwatch_db" \
   NEXTAUTH_URL=http://localhost:5571 \
   NEXTAUTH_SECRET=smoketest-secret-at-least-32-chars-long-x \
   NEXTAUTH_PROVIDER=email \
   PORT=5571 BASE_HOST=http://localhost:5571 \
   START_WORKERS=false \
   pnpm start:app
   ```
4. **Run both migrations** against the isolated DB via
   `pnpm prisma migrate deploy`.

## Running a single script

```sh
cd langwatch
DATABASE_URL="postgresql://langwatch_db:smoketest@localhost:5434/langwatch_db?sslmode=disable&schema=langwatch_db" \
SKIP_REDIS=1 BUILD_TIME=1 NODE_ENV=development \
NEXTAUTH_URL=http://localhost:5571 \
NEXTAUTH_SECRET=smoketest-secret-at-least-32-chars-long-x \
NEXTAUTH_PROVIDER=email \
BASE_HOST=http://localhost:5571 \
API_TOKEN_JWT_SECRET=test-secret-test-secret \
  pnpm exec tsx e2e/auth-regression/iter43-browser-qa.ts
```

Expected output ends with `✅ ALL CHECKS PASSED (N/N)`.

If you're running multiple scripts in a row, you may hit the
BetterAuth `/sign-in/email` rate limit (10/15min per IP) across runs.
Clear it between scripts:

```sh
redis-cli -p 6379 del 'better-auth:0000:0000:0000:0000:0000:0000:0000:0000|/sign-in/email'
redis-cli -p 6379 del 'langwatch:ratelimit:user.register:unknown'
```

## Safety

Every script calls `assertLocalhostDatabaseUrl()` (or uses scoped
`email: EMAIL` cleanup) to refuse to run against anything other
than a local Postgres. The cleanup section of each script is scoped
to either an exact test email or a per-run timestamp suffix
(`-${TS}@test.com`) so it can never touch unrelated users.

Never point `DATABASE_URL` at a shared environment when running
these.

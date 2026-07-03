# ADR-027: SSO is gated on possessing a genuine license, decided once at startup, recoverable via an instance license key

Date: 2026-07-03
Status: Accepted (v6 — supersedes the v3 Accepted request-time design; red-teamed and locked 2026-07-02/03)
Tracking: [#4673](https://github.com/langwatch/langwatch/issues/4673)

> One-line: every **non-email login provider** is a paid feature, gated **binary on possessing a genuinely-issued license** (`IS_SAAS || hasSignedInstanceLicense || anyOrgHasSignedLicense()` — **signature-valid, expiry deliberately ignored**: once a customer, never blocked), **decided once per process** (restart to change, never per request); a denied deployment **runs in email mode** as if the SSO env vars were unset — with **password reset open** so existing users can self-recover — and bootstraps via the **`LANGWATCH_LICENSE_KEY` env var**; **zero action required** from already-licensed customers, whose in-database org license is honored automatically.

## Context

LangWatch has two SSO surfaces, neither of which consults the license today:

1. **Instance-wide provider via env vars** — `NEXTAUTH_PROVIDER` + provider credentials register an OAuth/OIDC provider at module load (`langwatch/src/server/better-auth/index.ts:51-208`). Four env vars buy Auth0 SSO on a free self-hosted install. This is the bypass that forces the issue.
2. **Per-org `ssoDomain`** — domain-matched auto-join in the Better Auth hooks (`langwatch/src/server/better-auth/hooks.ts`). Writable **only by LangWatch super-admins via the backoffice** (`ee/admin/routes/admin.ts:387-397`, `isAdmin`-gated); customers cannot self-configure it. The formerly-planned self-serve `SsoProvider` plugin (PR #4416) is **closed, unmerged** — that third surface no longer exists.

Forces and constraints (locked in the v4 framing round, 2026-07-02):

- **Forcing function:** commercial repositioning — the OSS-lift (#4480 stack) removed experimentation and workspace caps, so Enterprise security (SSO among Audit Logs, RBAC, custom retention, SLAs) must actually be enforced as the remaining paid surface.
- **Blast radius: explicitly downgraded.** Licenses target enterprises; a licensed deployment must see zero change, but an *unlicensed* install losing free-riding SSO is acceptable and non-blocking. (v1–v3 treated lockout as max-rigor; the owner re-calibrated.)
- **Hard constraints re-confirmed:** no license schema change (the `verifySignature` re-serialization trap, `ee/licensing/validation.ts`); SaaS untouched (`IS_SAAS=true` short-circuits everything); all non-email providers gated — *login federation is the paid feature*, one rule.
- **Deliberately unlocked this round:** "license changes flip SSO without restart" (live flip). It was the assumption that forced the v2/v3 request-time machinery — the three-state gate, route truth table, TTL cache, and mounted-but-guarded password routes. The owner chose startup semantics instead; all of that machinery is deleted from this design.

Facts verified against `main` (2026-07-02) — two of which invalidate v2/v3 premises:

- `betterAuth({...})` is **one synchronous module-load construction** (`index.ts:236`); providers register from env at import time. A DB read cannot precede config build, so a DB-informed gate must *resolve* lazily even though its *semantics* are per-process.
- **Password reset now exists** (`index.ts:398-412`): `sendResetPassword` is wired to the transactional mailer, a `/auth/reset-password` page exists, and reset revokes all sessions. The v2 premise "password reset does not exist in this codebase" is stale — installs with SMTP have a working credential recovery.
- The **credential-mutation block already exists** in the global `before` hook (`index.ts:546-576`): `/set-password`, `/change-password`, `/change-email`, `/request-password-reset`, `/reset-password`, `/send-verification-email`, `/verify-email` are rejected whenever `NEXTAUTH_PROVIDER !== "email"`. This design reuses it unchanged.
- Customer IdP callbacks land on **legacy** `/api/auth/callback/auth0` and `/callback/okta` (pinned `redirectURI`, `index.ts:163,191`), rewritten to the plugin handler. Any SSO-path blocklist must include the legacy paths.
- License is stored **per-organization** (`Organization.license`, TEXT); for **plan limits**, no/expired/invalid resolves to `FREE_PLAN` (`ee/licensing/licenseHandler.ts`) — that stays untouched. For the **SSO gate specifically**, "genuine" means **`verifySignature()` passes** (`ee/licensing/validation.ts`); expiry is deliberately not checked (Decision 1). Never derive either from the denormalized `licenseExpiresAt` column, which skips signature checks.

## Decision

1. **Binary entitlement on license *authenticity*, not activeness — no license schema change.** SSO is allowed iff `IS_SAAS === true`, OR the `LANGWATCH_LICENSE_KEY` env var holds a **signature-valid** license (Decision 5), OR at least one organization row holds a **signature-valid** license — **expiry is deliberately ignored for the SSO gate** ("once a customer, never blocked", locked v6). Why: the gate's target is the free-rider who never had a license and cannot forge a signature; an *expired* license is an ex-/renewal-limbo customer, and cutting their whole company's login on a routine upgrade (upgrade = restart = re-evaluation) is exactly the blast radius the owner ruled out. Plan limits keep strict expiry (`validateLicense()`); only SSO uses signature-only. Cost owned in Consequences: churned customers retain SSO indefinitely; tightening later is a breaking change. No `enableSso` field is added to `LicensePlanLimitsSchema` — zero signature risk, zero re-issuance, addable later with `absent → true` semantics. Rejects: strict expiry (renewal-limbo lockout); N-day grace window (adds a second clock + still has a cliff); per-plan/field encoding (schema churn for no v1 gain).

2. **Scope: every non-email provider is gated.** `google`, `github`, `gitlab`, `azure-ad`, `okta`, `auth0` — everything `NEXTAUTH_PROVIDER ≠ email` registers. One rule: *login federation is the paid feature.* Cost owned in Consequences: unlicensed OSS installs using Google/GitHub sign-in are coerced to email mode on upgrade. Rejects: enterprise-IdPs-only scope (two provider classes, arbitrary boundary).

3. **The gate is decided once per process — "startup semantics", implemented as a memoized first-request check.** Because `betterAuth()` builds synchronously from env, providers stay registered at boot; the gate resolves on the first auth-relevant request: `platformSSOAllowed() = IS_SAAS || hasSignedInstanceLicense() || anyOrgHasSignedLicense()`, then **memoizes for the process lifetime**. License activated in the UI → takes effect on next restart. License expiry never turns SSO off at all (Decision 1 — signature-only). Why: deletes the TTL cache, cache invalidation, the three-state gate, and the route truth table wholesale; self-hosted operators restart containers routinely, and the recovery path (Decision 5) already required a restart in the v3 design. Rejects: request-time evaluation (the whole v2/v3 complexity for a "live flip" nobody required); pure boot-time env-only gating (would force every existing licensed customer to add an env var — violates the zero-action constraint).

4. **Denied state = email mode, exactly as if the SSO env vars were unset — but email routes are re-blocked on ALLOW.** The `before` hook reads the one memoized gate value and branches **both** directions from it:
   - **When the gate DENIES** (SSO-capable install, no license): the gated **SSO-initiation and callback paths** (Constants) return 403 — the hook is the only place that sees the legacy `/callback/auth0|okta` rewrite. `emailAndPassword.enabled` is `true` (see below) so the email form is the working coerced door; fresh email **sign-up** is allowed (self-serve path to activating a license, Decision 5b).
   - **When the gate ALLOWS** on an SSO-capable install (`NEXTAUTH_PROVIDER !== "email"`): the hook 403s `/sign-in/email` and `/sign-up/email`. This preserves `main`'s guarantee that an Auth0/Okta deployment cannot mint password accounts — a guarantee that would otherwise be **lost** by the `enabled` formula change (see Consequences; this is the v5 BLOCKER fix). The email-route block keys off **gate-ALLOW**; the SSO-path block keys off **gate-DENY**; both consult the same memoized value in the same async hook — no truth table.
   - `publicEnv` reports `NEXTAUTH_PROVIDER` as `"email"` via `resolveAuthProvider()` only when the gate denies, so the sign-in page renders the email form and never auto-redirects to the IdP.
   - `emailAndPassword.enabled` becomes `env.NEXTAUTH_PROVIDER === "email" || !IS_SAAS` so the email routes are *mountable* for the coerced (denied) mode; the ALLOW-path hook block above is what keeps them from being a bypass when a license is present. SaaS is unchanged (routes stay unmounted unless natively email-mode).
   - The **credential-mutation block stays keyed off `env.NEXTAUTH_PROVIDER !== "email"`** (the *configured* mode) for `/set-password`, `/change-password`, `/change-email` and the verification routes: in **every** gate state, no logged-in session can attach or change a password on an SSO-capable deployment.
   - **Exception (v6): the password-reset pair opens when the gate DENIES.** `/request-password-reset` + `/reset-password` are blocked on ALLOW (as today) but **allowed in denied mode**. Why: on a denied install every existing user is OAuth-born with **no password** — SSO 403s, re-signup hits `USER_ALREADY_EXISTS`, and with reset also blocked they are hard-stranded until an operator acts. better-auth's `resetPassword` **creates a credential account when none exists** (verified, `routes/password.mjs:33-39`), so reset is the self-service door that converts existing humans to email login. It is inbox-proof — completing it requires control of the victim's mailbox, unlike the session-based `set-password` vector the block exists for. Requires SMTP; installs without SMTP fall back to operator recovery (Decision 5).
   Rejects: hard-block explainer screen (bricks the install with no way to reach settings); grace/nag mode (leaves the bypass open); reset blocked in all states (v5 — stranded every existing user on denied installs with no self-service exit).

5. **`LANGWATCH_LICENSE_KEY` (instance license) is the bootstrap and recovery path.** An optional env var holding a signed license, checked with the same synchronous `verifySignature()` (signature-only, matching Decision 1) — no org row, no DB required. Recovery paths for a denied install, in order: (a) set `LANGWATCH_LICENSE_KEY`, restart — no login, no SMTP needed; (b) with SMTP, existing users self-recover via password reset (open in denied mode, Decision 4) and an admin activates a license in Settings, restart; (c) sign up a fresh email account, activate an org license, restart. Standard self-hosted pattern (Langfuse EE equivalent).

6. **Gate failure = deny SSO for that request, do not memoize.** If the org-license DB read throws, the gate returns deny *without* freezing the answer; the next request retries. A DB blip during warm-up therefore cannot permanently coerce an entitled deployment to email mode — it self-heals as soon as the DB answers. Fail-closed for SSO; no state machine.

7. **No per-org *license* gate — but the `ssoDomain` auto-join rides the platform gate.** No per-org license check: `ssoDomain` is writable only by LangWatch staff, who set it exclusively for paying customers, so a per-org *license* evaluation would add code without adding protection. The v3 `canOrgSSO` composition, the denied-`ssoDomain` fallthrough, and the SaaS per-org plan refinement are all **dropped**. **However**, the `afterUserCreate` domain-match auto-join (`hooks.ts:110`) is federation — a login capability — and runs on **email+password** signup too, not just OAuth. In coerced (denied) mode with fresh-signup open, an unverified `POST /sign-up/email {email:"x@customerdomain.com"}` would otherwise auto-join the customer's org with **no IdP round-trip** (v5 MAJOR fix). So the auto-join branch is guarded on `platformSSOAllowed()`: same paid switch as every other provider ("login federation is the paid feature"), one gate read at `hooks.ts:110`, no per-org license logic. Re-introduce a full per-org gate only if customer self-serve SSO configuration ships. Rejects: per-org license check (guards a staff-only surface at the cost of a second gate); email-verification-only fix (the feature is meant to be *off* when denied, not merely slower).

8. **Telemetry: server logs only — and the gate explains itself.** At gate resolution: (a) on deny with SSO env vars configured, one loud `logger.warn` (`"SSO is configured but no genuine license was found — starting in email mode; set LANGWATCH_LICENSE_KEY or activate an organization license to enable SSO"`); (b) **per candidate license inspected, log the org id and the verification outcome** (signature ok / signature failed) — without this, a mis-parsed old license is indistinguishable from "no license" and support debugging is blind; (c) when SSO is granted by an *expired* (signature-valid) license, a gentle `logger.warn` naming the org and expiry date — the renewal nudge. Plus a `logger.warn` per blocked SSO request (`{ path, reason: "no_license" }`). No PostHog event: with startup semantics, denial is a deployment state, not an event stream; self-hosted installs frequently block telemetry anyway. Reverses v3. Addable later without redesign.

9. **Sessions survive the gate.** The gate guards new authentication attempts only; existing session cookies are provider-independent and keep working through upgrades and gate flips. A licensed customer's live sessions never break mid-deploy.

10. **Self-hosted multi-org: any one org's genuine license enables the instance IdP for all orgs — deliberate.** The instance-wide `NEXTAUTH_PROVIDER` IdP is a deployment-level capability; one signed license (org or instance) proves the deployment is or was a customer. Documented so a multi-org self-hoster doesn't file it as an entitlement bug.

## Constants

| Name | Value | Purpose |
|---|---|---|
| `LANGWATCH_LICENSE_KEY` | env var (optional, signed license string) | Instance-level entitlement; bootstrap + credential-less recovery (Decision 5) |
| Gate memoization | once per process; **errors are not memoized** | Startup semantics (Decision 3) + self-healing warm-up (Decision 6) |
| Gated providers | every `NEXTAUTH_PROVIDER ≠ email` (`google, github, gitlab, azure-ad, okta, auth0`) | Decision 2 |
| Gated SSO paths (block on gate-DENY) | **initiation**: `/sign-in/social`, `/sign-in/oauth2`, `/link-social`, `/oauth2/link` · **callbacks (pathname-prefix match)**: any path containing `/callback/` or `/oauth2/callback/` | Decision 4. Verified against better-auth 1.6.x + genericOAuth (v5 MAJOR fix): genericOAuth initiates at `/sign-in/oauth2` (NOT the phantom `/oauth2/authorize`); social callbacks are `/callback/:id`, genericOAuth `/oauth2/callback/:id`, legacy rewrites `/callback/auth0\|okta`. `/link-social`+`/oauth2/link` blocked so coerced-mode users can't pre-link a provider that goes live after an allow-flip. Callback match MUST be pathname-prefix (`includes("/callback/")`), not the current `endsWith`/suffix helper — callbacks carry `?code=&state=` + a provider segment |
| Gated email paths (block on gate-ALLOW, SSO-capable only) | `/sign-in/email`, `/sign-up/email` | Decision 4 BLOCKER fix — preserves `main`'s no-password-account guarantee on licensed Auth0/Okta installs |
| Credential-mutation paths (block in ALL states, SSO-capable) | `/set-password`, `/change-password`, `/change-email`, `/send-verification-email`, `/verify-email` | Existing block (`index.ts:546-576`), keyed off configured mode |
| Password-reset pair (block on gate-ALLOW only) | `/request-password-reset`, `/reset-password` | v6: open in denied mode so stranded OAuth-born users self-recover (Decision 4); inbox-proof, and better-auth reset creates the credential account |
| Gate module | `langwatch/src/server/sso/sso-gate.ts` | Single source of truth for the gate + `resolveAuthProvider()` |

## Invariants

| Invariant | Meaning | Satisfied by / test anchor |
|---|---|---|
| **Ever-licensed = zero action, zero change** | A self-hosted deployment with any *genuinely-issued* org license — **even expired** — upgrades and SSO keeps working, no new env var, no config step | Decisions 1+3; integration tests: seeded valid license AND seeded expired-but-signed license, no `LANGWATCH_LICENSE_KEY` → SSO paths open in both |
| **No lockout** | A denied deployment always has a way back: env key + restart (no login, no SMTP), fresh email signup, or password reset when SMTP exists | Decision 5; integration test: denied install → set env key → gate allows |
| **No SSO-account takeover** | On an SSO-capable deployment with a license, no password account can be minted or attached through any Better Auth endpoint; on a denied one, only via inbox-proof reset | Decision 4. Three anchors: (a) `/set-password` 403 in every gate state; (b) on ALLOW: `/sign-up/email`, `/sign-in/email`, `/request-password-reset` all 403 (the v5 BLOCKER anchor); (c) on DENY: reset works end-to-end only with a valid emailed token |
| **Stranded users can self-recover** | On a denied install with SMTP, an existing OAuth-born user (no password) regains access without an operator | v6 Decision 4 reset exception; test: gate denies → `/request-password-reset` for an OAuth-born user → `/reset-password` with token creates a credential account and login succeeds |
| **Denied auto-join is off** | In coerced (denied) mode, an unverified email signup whose domain matches an org `ssoDomain` does NOT auto-join that org | Decision 7 guard at `hooks.ts:110`; test: gate denies → `/sign-up/email` with a matching domain creates a user with no org membership |
| **Fail closed for SSO, self-healing** | A gate eval error denies SSO for that request and is retried — never memoized, never opens SSO | Decision 6; unit test with throwing repository, second call succeeds |
| **SaaS: zero change** | `IS_SAAS=true` short-circuits the gate; email routes stay unmounted unless natively email-mode | Decisions 1+4; unit test |
| **No signature risk** | Already-issued licenses validate byte-identically | No schema change (Decision 1); existing backward-compat test untouched |
| **Frozen until restart** | The gate answer never changes mid-process (except error-retry before first success) | Decision 3 memoization; unit test: license added to DB after memoization → still denied until "restart" (module reset) |
| **Sessions survive** | Gate never invalidates existing sessions | Decision 9; migration test |

## Schema

No database migration. No license payload schema change. One env var, one new module, three call-site edits:

```ts
// langwatch/src/server/sso/sso-gate.ts  (new — single source of truth)
export async function platformSSOAllowed(): Promise<boolean>;
//   IS_SAAS || hasSignedInstanceLicense(env.LANGWATCH_LICENSE_KEY) || anyOrgHasSignedLicense()
//   "signed" = verifySignature() passes; expiry deliberately ignored (Decision 1)
//   memoized once per process; a thrown DB error returns false and is NOT memoized
export async function resolveAuthProvider(): Promise<string>;
//   env.NEXTAUTH_PROVIDER, coerced to "email" when the gate denies
```

```js
// langwatch/src/env-create.mjs — additive, optional
LANGWATCH_LICENSE_KEY: z.string().optional(),
```

Gate sites (implementation order):

| # | Surface | File | Behavior |
|---|---|---|---|
| 1 | `publicEnv` provider exposure | `src/server/api/routers/publicEnv.ts` | on DENY, report `"email"` via `resolveAuthProvider()` |
| 2 | Better Auth `before` hook — SSO-path block | `src/server/better-auth/index.ts:546` (extend the existing hook) | on DENY, 403 the gated SSO paths (Constants, pathname-prefix callback match incl. legacy) |
| 3 | Better Auth `before` hook — email-path block | `src/server/better-auth/index.ts:546` (same hook) | on ALLOW + SSO-capable, 403 `/sign-in/email` + `/sign-up/email` (BLOCKER fix) |
| 4 | `ssoDomain` auto-join guard | `src/server/better-auth/hooks.ts:110` | skip the domain auto-join unless `platformSSOAllowed()` (MAJOR fix) |
| 5 | `emailAndPassword.enabled` boot flag | `src/server/better-auth/index.ts:378` | `env.NEXTAUTH_PROVIDER === "email" \|\| !IS_SAAS` (mount routes; site #3 guards them) |

Both hook branches (sites #2, #3) read the **same** memoized gate value in the one async `before` hook. `platformSSOAllowed()` memoizes only a **successful resolution** — a rejected/false promise from a DB blip is evicted, never cached, so concurrent first-requests fail closed and converge to allow on first success (Decisions 3+6; MINOR-5 contract). `anyOrgHasSignedLicense()` MUST run `verifySignature()` per candidate row — the signature is the *sole* criterion (Decision 1), so never filter on the denormalized `licenseExpiresAt` column or any unverified field; the scan skips soft-deleted orgs, is wrapped in try/catch → `false`-without-memoize, logs each candidate's outcome (Decision 8b), and `IS_SAAS` short-circuits **before** it runs (MINOR-4).

Explicitly **not** gate sites: per-org *license* checks (Decision 7 — but note the auto-join platform-gate guard at site #4), backoffice `ssoDomain` writes (already `isAdmin`-gated), `SsoProvider` CRUD (PR #4416 closed).

## Rejected alternatives

- **Request-time enforcement (the v2/v3 design)** — three-state gate, route truth table, 60s TTL cache + invalidation, per-request evaluation. Its sole benefit ("live flip" on license change) was never a requirement; its recovery path already required a restart. Startup semantics deletes ~all of its moving parts.
- **Env-key-only static gate (pure boot-time, Langfuse model)** — maximally simple, but every existing licensed customer must add `LANGWATCH_LICENSE_KEY` on upgrade: a breaking migration step, rejected against the zero-action constraint.
- **Strict license expiry for the SSO gate (v1–v5)** — a lapsed renewal + a routine upgrade (which is a restart) cuts company-wide login for a real customer; rejected in v6 for signature-only. A 30-day grace window was also rejected: it adds a second clock and merely moves the cliff.
- **Password reset blocked in all gate states (v2 F4, v5)** — predates reset existing in the codebase; on denied installs it hard-strands every OAuth-born user with no self-service exit. v6 opens the reset pair on gate-DENY only (inbox-proof).
- **`enableSso` license field** — stays available later with `absent → true`; not needed for v1.
- **Per-org `canOrgSSO` composition + denied-`ssoDomain` fallthrough** — guarded a staff-only surface; dropped (Decision 7).
- **Grandfather credential-less installs / grace-nag denied mode** — leaves the env-var bypass open for exactly the installs likeliest to abuse it.
- **Hard-block explainer screen** — bricks the install with no path to Settings; email coercion keeps a working door.
- **PostHog `sso_gate_denied` event (v3 Decision 7)** — denial is now a deployment state, not a stream; logs carry the signal, event addable later.
- **Path-prefix middleware on `/oauth2/*`** — still misses the legacy `/callback/auth0|okta` rewrite; the `before` hook remains the only correct interception point.

## Consequences

**Positive**
- The four-env-var free-SSO bypass is closed with one binary rule and **one memoized function** — no cache lifecycle, no truth table, no state machine.
- Zero action and zero behavior change for every customer who ever held a license (DB license honored, expiry ignored); zero signature/compat risk.
- **No expiry cliff at all**: a renewal-limbo customer can upgrade (restart) mid-lapse and SSO stays on — the "blocked paying customer" scenario is structurally impossible (v6).
- Denied installs are only ever *never-licensed* installs, and even their existing users self-recover via password reset (with SMTP).
- One module owns the rule; `resolveAuthProvider()` centralizes provider exposure.

**Negative**
- **Churned customers keep SSO indefinitely** — any once-issued license grants SSO forever (signature-only). Accepted deliberately ("once a customer, never blocked"); commercial pressure for renewals lives in plan limits (strict expiry) and the renewal-nudge log, not in login lockout. Tightening this later is a breaking change requiring its own ADR revision.
- **Never-licensed installs using Google/GitHub/Auth0 sign-in lose SSO on upgrade** (coerced to email mode). Needs a loud changelog + release note spelling out `LANGWATCH_LICENSE_KEY`, the denied-mode password-reset path for existing users, and the fresh-signup path. Accepted deliberately (blast radius re-calibrated: free-riders are the target).
- License activation via the Settings UI requires a **restart** to enable SSO. Needs an explicit hint in the license-activation success state ("restart the server to enable SSO"). Accepted as the price of startup semantics.
- Password sign-in/up routes become **mounted** on self-hosted SSO deployments (the `enabled` formula change). On their own this is a bypass — a licensed Auth0 install could mint a password account. The **ALLOW-path email-route block (gate site #3) is the load-bearing guard** and its test anchor (`/sign-up/email` 403s with a license) is mandatory, alongside the credential-mutation block. Regression caught in the v5 red-team.
- `usePublicEnv` caches `staleTime: Infinity` — after a restart-with-license, users with an open tab must reload to see the IdP button. Server gate is authoritative; note in the release note.

**Neutral**
- The gate's DB read (`anyOrgHasSignedLicense`) runs once per process — index on `license IS NOT NULL`, then `verifySignature()` per candidate row. Do **not** optimize into a `licenseExpiresAt` filter: that column is unverified, and expiry doesn't gate SSO anyway (Decision 1).
- The Helm chart (`charts/`) must plumb `LANGWATCH_LICENSE_KEY` through values → env; add alongside the env-create.mjs change.
- "As if the SSO env vars were unset" is *almost* exact: a denied genericOAuth install can still `POST /sign-in/oauth2` and be redirected to the IdP — the callback-path block is what fails the round-trip closed (login never completes). The initiation redirect happening is cosmetic, not a bypass; documented so the implementer blocks the callback, not just the button.
- e2e auth harnesses (`e2e/auth-regression/*`, `*sso-smoketest*`) that assume ungated SSO must seed a license or the env key. Audit set: `rg -l 'NEXTAUTH_PROVIDER' e2e/ langwatch/src` + the auth harness files.
- `specs/licensing/sso-license-gating.feature` (ships in the same PR) must be rewritten against this design — the truth-table scenarios are obsolete; add scenarios for the v5/v6 anchors (licensed `/sign-up/email` 403; denied-mode auto-join off; expired-but-signed license allows; denied-mode reset recovers an OAuth-born user).

## Open questions

| Question | Owner | Status |
|---|---|---|
| Settings UI: show "restart required" after license activation on self-hosted | Sergio | Small UX addition — decide during implementation, non-blocking |
| Do all known self-hosted enterprise deployments actually have an in-DB activated license? (We can't see their DBs; the release note's `LANGWATCH_LICENSE_KEY` belt-and-braces covers the gap, but an internal check with CS/sales de-risks the rollout) | Sergio | Operational — before shipping the enforcement PR |
| Multiple orgs with licenses: first-signed-wins scan order | Sergio | Trivial — any signed license allows; order irrelevant, confirm in review |

## Revisions

- **v1 (2026-06-12)** — Initial ADR: binary activeness, all non-email providers, coerce-to-email, request-time enforcement, no grace, logs-only telemetry.
- **v2 (2026-06-13)** — Red-team folded in: `LANGWATCH_LICENSE_KEY` recovery (F1 — password reset believed absent), legacy-callback enumeration (F2), three-state gate + route truth table (F3), credential-mutation block in all states (F4), multi-org grant documented (F5), `validateLicense` as the only validity source (F6).
- **v3 (2026-06-15)** — Telemetry reversed to logs + PostHog `sso_gate_denied`. Locked as Accepted.
- **v4 (2026-07-02)** — Parc-fermé re-framing with the owner; mechanism fork re-opened and re-locked. What changed and why:
  - **Startup semantics replace request-time** (owner unlocked the never-confirmed "live flip" assumption): the gate is computed once per process and frozen until restart. Deletes the three-state gate, route truth table, TTL cache, and cache invalidation (v2 F3's machinery is obsolete, not overruled — with one frozen decision there is no per-request state to get wrong).
  - **Gate source locked as env + DB, once**: existing licensed customers upgrade with zero action; pure-env (Langfuse-style) rejected for the migration cost.
  - **Per-org gate dropped** (v3 Decisions 5/11): `ssoDomain` is super-admin-only in the backoffice, and PR #4416 (self-serve `SsoProvider`) is closed — the surface it guarded doesn't exist.
  - **Telemetry back to logs-only** (reverses v3): denial is a deployment state under startup semantics.
  - **Fact corrections against `main`**: password reset now exists (`sendResetPassword` wired, reset page live) — v2 F1's premise is stale, though the env-key recovery remains the credential-less path; stale references to closed PR #4416 and the "ships on PR" framing removed.
  - Blast radius re-calibrated by owner: unlicensed-install lockout is acceptable; licensed deployments must see zero change (new leading invariant).
- **v5 (2026-07-02)** — Red-team (`/challenge`) folded in. The startup-semantics core held; three defects in the *draft's mechanism* (not the locked forks) were fixed:
  - **BLOCKER — licensed-install credential bypass (regression vs `main`).** The `emailAndPassword.enabled = "email" || !IS_SAAS` change mounts `/sign-in/email` + `/sign-up/email`, and nothing re-blocked them on the ALLOW path → a licensed Auth0 install could mint password accounts (worse than `main`, where they 404). Fixed by a second branch in the same `before` hook: block those two routes when SSO-capable **and** the gate allows (gate site #3). No truth table — one memoized value, branched both ways.
  - **MAJOR — denied-mode `ssoDomain` org takeover.** `afterUserCreate` auto-joins by email domain on email+password signup with no verification; in coerced mode with fresh-signup open, `POST /sign-up/email` at a customer's domain joins their org with no IdP. Fixed by gating the auto-join on `platformSSOAllowed()` (site #4) — federation rides the paid switch. Nuances Decision 7: still no per-org *license* check, but the auto-join is not license-blind.
  - **MAJOR — wrong gated-path list.** `/oauth2/authorize` is a phantom (OIDC-provider endpoint, not a client one); real genericOAuth initiation `/sign-in/oauth2` was missing; `/link-social`+`/oauth2/link` were unblocked; the `endsWith` matcher can't match callbacks carrying `?code=&state=`. Constants table corrected + switched to pathname-prefix callback matching.
  - MINOR — `validateLicense()`-per-row (never `licenseExpiresAt`), `IS_SAAS` short-circuit before the DB read, and memoize-success-only / evict-on-reject written into the Schema contract.
  - Surfaces judged **sound**: multi-pod skew (denied pod is strictly more restrictive — no partial-auth), error-retry flapping (both directions fail closed), duplicate-email signup (better-auth returns `USER_ALREADY_EXISTS`), and `/request-password-reset` (stays 403 via the mutation block). [The reset-blocking judgment is revised in v6.]
- **v6 (2026-07-03)** — Owner-driven adversarial pass focused on "can a self-hosted customer get blocked?". Two missed decisions found and locked:
  - **Expiry no longer gates SSO — signature-only ("any signed license ever = allow").** v4 wrongly declared the expiry-grace question dissolved by frozen-until-restart; an upgrade IS a restart, so a renewal-limbo customer would have lost company-wide SSO the morning they upgraded. Owner locked the strongest option: `verifySignature()` is the sole criterion, expiry ignored. Cost accepted: churned customers keep SSO forever; renewals are pressured via plan limits + a renewal-nudge log, not login lockout. Rejected: strict expiry (the lockout), 30-day grace (second clock, still a cliff).
  - **Password-reset pair opens in denied mode.** On a denied install every existing user is OAuth-born with no password: SSO 403, re-signup `USER_ALREADY_EXISTS`, reset blocked → hard-stranded until an operator acts. Verified better-auth's `resetPassword` creates a credential account when none exists (`routes/password.mjs:33-39`), so `/request-password-reset` + `/reset-password` are now allowed on gate-DENY (inbox-proof) and blocked on gate-ALLOW. Revises the v2 F4 all-states block, which predates password reset existing.
  - Folded operational findings: per-candidate license-verification logging + expired-license renewal nudge (Decision 8), Helm chart plumbing for `LANGWATCH_LICENSE_KEY`, soft-deleted orgs skipped in the scan, and an open question to verify which enterprise deployments have in-DB activated licenses before the enforcement PR ships.

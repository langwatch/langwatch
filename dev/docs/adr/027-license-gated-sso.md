# ADR-027: SSO is gated on license activeness, enforced at request time, recoverable via an instance license key

Date: 2026-06-13
Status: Accepted (locked 2026-06-15)
Refines: prior SSO gating analysis (internal design note, 2026-06-08) · Tracking: [#4673](https://github.com/langwatch/langwatch/issues/4673) · Ships on: PR #4830 (stacks on #4480)

> One-line: every **non-email login provider** is a paid feature, gated **binary on license activeness** (`IS_SAAS || validInstanceLicense || anyOrgHasActiveLicense()`), enforced **per-request** (never at provider registration); a denied deployment **coerces to email mode** for sign-up/sign-in while **never allowing a password to be set on an SSO account**, and an SSO-only install with no SMTP recovers by setting an **instance license key env var** — not by password reset.

## Context

LangWatch has three SSO surfaces, none of which consults the license today:

1. **Instance-wide provider via env vars** — `NEXTAUTH_PROVIDER` + provider credentials register an OAuth/OIDC provider at boot (`langwatch/src/server/better-auth/index.ts:49-206`). Four env vars buy Auth0 SSO on a free self-hosted install. This is the bypass that forces the issue.
2. **Per-org `ssoDomain`/`ssoProvider`** — domain-matched auto-join and provider enforcement in the Better Auth hooks (`langwatch/src/server/better-auth/hooks.ts:114-414`), per-request, ungated.
3. **Per-org `SsoProvider` (OIDC+SAML plugin)** — PR #4416, still open, not on `main`. Must be gated by this design when it lands.

Forces and constraints (locked in framing):

- **Forcing function:** commercial repositioning with PR #4480 — the OSS-lift removed experimentation caps, so Enterprise security (SSO among it) must actually be enforced as the remaining paid surface.
- **Blast radius: login lockout.** Worst case is a self-hosted org whose users authenticate exclusively via SSO losing all sign-in after upgrade. Max rigor: invariants + test anchors + red-team pass (done — see Revisions v2).
- **SaaS is never gated at platform level** — `IS_SAAS=true` short-circuits the platform gate; per-org refinement applies (Decision 5).
- **License signature trap:** `verifySignature` re-serializes the Zod-parsed payload (`ee/licensing/validation.ts:47`), so schema changes are dangerous; this design makes **no schema change at all**.

Facts verified against better-auth 1.6.11 and the current config — these shape the mechanism and were the source of the v2 red-team corrections:

- `genericOAuth` takes a **static** `config: GenericOAuthConfig[]` — no per-request provider resolution. Registration-time gating would require a restart on every license change.
- `emailAndPassword.enabled` is a **boot-time security gate** (`index.ts:375-381`): password sign-in/up routes are unmounted in SSO mode. A global `before` hook (`index.ts:514-543`) additionally blocks credential-mutation routes (`/set-password`, `/change-password`, `/request-password-reset`, `/reset-password`, `/change-email`, `/send-verification-email`, `/verify-email`) whenever `NEXTAUTH_PROVIDER !== "email"`.
- **Password reset does not exist in this codebase.** `sendResetPassword` is never configured; `/request-password-reset` returns `RESET_PASSWORD_DISABLED` (`index.ts:404`). There is no forgot-password UI. `requireEmailVerification` is unset. Self-hosted installs frequently have **no SMTP** (`HAS_EMAIL_PROVIDER_KEY` is often false). ⇒ "recover via password reset" is not a usable recovery path; the v1 draft's central safety claim was false.
- Customer IdP callbacks land on **legacy** `/api/auth/callback/auth0` and `/callback/okta`, which `api-router.ts:74-92` rewrites and re-dispatches to `/api/auth/oauth2/callback/*`. A path-prefix guard on `/oauth2/*` alone misses the inbound legacy path.
- License is stored **per-organization** (`Organization.license`, TEXT); no/expired/invalid license resolves to `FREE_PLAN` (`licenseHandler.ts:74-94`). There is no deployment-wide license today — Decision 9 adds an optional instance-level one for recovery.

## Decision

1. **Binary entitlement — no license schema change.** SSO is allowed iff `IS_SAAS === true`, OR a valid **instance license key** is set (Decision 9), OR at least one organization holds a currently-valid license. No `enableSso` field is added to `LicensePlanLimitsSchema`. Why: zero signature risk, zero re-issuance, ships now; the field stays addable later with `absent → true` semantics, exactly backward-compatible with this decision. "Valid" everywhere means **`validateLicense()` returns `valid`** (signature + non-expired) — never the denormalized `licenseExpiresAt` column, which skips signature checks (red-team F6).

2. **Scope: every non-email provider is gated.** `google`, `github`, `gitlab`, `azure-ad`, `okta`, `cognito`, `auth0` — plus per-org `ssoDomain` auto-join and the future per-org `SsoProvider` CRUD. One rule: *login federation is the paid feature.* Cost owned in Consequences: OSS installs using Google/GitHub sign-in are coerced to email mode on upgrade.

3. **Enforcement at request time, in the Better Auth `before` hook, never at registration.** Providers stay registered at boot from env. The gate is enforced where requests arrive, via the existing global `before` hook (`index.ts:514-543`) extended to consult the runtime gate, because the single catch-all + legacy-callback rewrite means a path-prefix middleware would miss the legacy paths (red-team F2). The enforced path set is exhaustive (Constants → "Gated auth paths") and **must include the legacy `/callback/auth0` and `/callback/okta`** alongside `/sign-in/social`, `/oauth2/authorize`, `/oauth2/callback/*`. `publicEnv` returns `"email"` for `NEXTAUTH_PROVIDER` when the platform gate denies (`publicEnv.ts:24`), so the sign-in page never auto-redirects to the IdP. Why request-time: better-auth's static config makes registration-time gating restart-bound; this way activating a license flips SSO on **live**, expiry flips it off within the cache TTL.

4. **Denied state = coerce to email mode, but credential mutation on SSO accounts is never allowed.** Driven by a three-state gate (`ALLOW` / `DENY` / `UNKNOWN`-on-error) and a fixed route truth table (Constants). The load-bearing rules:
   - **SSO routes:** `ALLOW` → open; `DENY` → 403; `UNKNOWN` → 403. (Fail closed for SSO.)
   - **Email sign-in / sign-up (`/sign-in/email`, `/sign-up/email`):** open **only** on definitive `DENY`; `ALLOW` and `UNKNOWN` → 403. So a transient DB error never opens email login on an entitled deployment (fixes the fail-closed inversion, red-team F3).
   - **Credential-mutation routes (`/set-password`, `/change-password`, `/request-password-reset`, `/reset-password`, `/change-email`, verify-email):** **blocked whenever the deployment is SSO-capable** (`NEXTAUTH_PROVIDER !== "email"`), in *every* gate state including `DENY`. This is the explicit fix for account-takeover (red-team F4): an attacker must never be able to plant a password on an email that has an SSO-only account during a license lapse. Only a natively email-mode deployment (`NEXTAUTH_PROVIDER === "email"`) allows these.
   - To make email routes *mountable* for the coercion, `emailAndPassword.enabled` becomes `NEXTAUTH_PROVIDER === "email" || !IS_SAAS`; the truth-table guard then governs them at runtime. SaaS is unchanged (`IS_SAAS=true` ⇒ routes stay unmounted unless email mode).
   Rejects: hard-block explainer screen (bricks SSO-only installs), grace/nag mode (leaves the bypass open).

5. **Two gates that compose, not fold.**
   - `canPlatformSSO(): Promise<boolean>` — process-wide: `IS_SAAS || validInstanceLicense() || anyOrgHasActiveLicense()`. Cached (Constants), `UNKNOWN`/fail-closed on DB error.
   - `canOrgSSO(organizationId): Promise<boolean>` — per-org: on SaaS, `getActivePlan(org)` is not free; on self-hosted, that org holds a valid license **or** a valid instance license is set (an instance license entitles the whole deployment). Uncached (primary-key lookup on an existing hot path).
   Why two: on SaaS, org A paying must not grant org B per-org SSO. Platform-allowed + org-denied = the IdP button may show, but the unpaid org's `ssoDomain` never auto-joins and its SSO config writes reject.

6. **Expiry: no grace period in v1.** A license that expires flips SSO to denied within one cache window. Acceptable because recovery is the instance license key (Decision 9), not a stranded login. Grace (14–30 days + banners) is a tracked follow-up, addable without redoing the gate.

7. **Telemetry: server logs + a PostHog event.** Denied attempts log `logger.warn` with `{ surface: "platform" | "per-org", reason: "no_license" | "free_plan", organizationId? }` **and** emit a PostHog `sso_gate_denied` event with `{ surface, reason }` at 100% sample (these are rare). Two purposes: detect bypass attempts (operator sets SSO env vars on a free deploy) and surface upgrade-intent leads for sales. No org PII beyond IDs already in PostHog. This is a deliberate, low-volume signal — distinct from the high-volume limit-tied `limit_blocked` event PR #4480 removed.

8. **Sessions survive the gate.** The gate guards new authentication attempts only; existing session cookies are provider-independent and keep working through upgrades and expiry. A paying customer's live sessions never break mid-deploy.

9. **Instance license key (`LANGWATCH_LICENSE_KEY`) is the credential-less recovery path.** An optional env var holding a signed license, validated by the same `validateLicense()`. It feeds `canPlatformSSO`/`canOrgSSO` directly without any org row. This is what makes the No-lockout invariant *true* for the SSO-only / no-SMTP population (red-team F1): an operator whose org license lapsed sets the env var and restarts → SSO returns with **no login and no email required**. It is also the bootstrap path for a fresh self-hosted install. Standard self-hosted pattern (Langfuse EE does the same). Recovery paths, in priority: (a) set `LANGWATCH_LICENSE_KEY` + restart; (b) on a denied install, sign **up** a fresh email account and activate an org license in Settings (flips SSO on live); (c) password reset is explicitly **not** a path.

10. **Self-hosted multi-org: any one org's license enables the instance IdP for all orgs — deliberate.** The instance-wide `NEXTAUTH_PROVIDER` IdP is an operator/deployment-level capability; a single valid license (org-level or instance-level) proves the deployment is paying. Per-org entitlement is what `canOrgSSO` refines (`ssoDomain`, `SsoProvider`). Documented so a multi-org self-hoster doesn't file it as an entitlement bug (red-team F5).

11. **Denied per-org `ssoDomain` signup falls through to regular signup.** When `canOrgSSO` denies, the domain lookup behaves as no-match: the user gets a working (personal/org-less) account rather than an error — denying the free tier to the very users who'd champion the upgrade is worse. Org placement is expected to self-heal on a later login once the license returns; the `sso-orphan-user-linking` machinery is the reuse target and **its self-heal-on-relogin behavior is a required test anchor** (red-team F9, Open Questions).

## Constants

| Name | Value | Purpose |
|---|---|---|
| `PLATFORM_SSO_CACHE_TTL_MS` | `60_000` | `canPlatformSSO()` cache window; bounds expired-license propagation to ≤60s |
| `LANGWATCH_LICENSE_KEY` | env var (optional) | Instance-level signed license; credential-less recovery + bootstrap (Decision 9) |
| Cache invalidation | on `validateAndStoreLicense` success and `removeLicense` (`licenseHandler.ts:103,294`) | License activation/removal flips SSO immediately |
| Gate states | `ALLOW` / `DENY` / `UNKNOWN` | `UNKNOWN` = eval threw; not cached, retried next request |
| Gated providers | `google, github, gitlab, azure-ad, okta, cognito, auth0` (every `NEXTAUTH_PROVIDER` ≠ `email`) | Decision 2 |
| Gated auth paths | `/sign-in/social`, `/oauth2/authorize`, `/oauth2/callback/*`, **`/callback/auth0`**, **`/callback/okta`** | Decision 3 — legacy callbacks included (F2) |
| Credential-mutation paths (always blocked when SSO-capable) | `/set-password`, `/change-password`, `/request-password-reset`, `/reset-password`, `/change-email`, `/send-verification-email`, `/verify-email` | Decision 4 (F4) |
| Gate module | `langwatch/src/server/sso/sso-gate.ts` | Single source of truth; only module that reads `env.NEXTAUTH_PROVIDER` after migration |

**Route truth table** (rows = route class, cells = action by gate state; SSO-capable deployment, i.e. `NEXTAUTH_PROVIDER ≠ email`):

| Route class | `ALLOW` | `DENY` | `UNKNOWN` |
|---|---|---|---|
| SSO sign-in / callback (incl. legacy) | open | 403 | 403 |
| `/sign-in/email`, `/sign-up/email` | 403 | open | 403 |
| Credential-mutation paths | blocked | blocked | blocked |

(Natively email-mode deployments — `NEXTAUTH_PROVIDER === "email"` — bypass the table entirely: password fully works, no SSO, gate irrelevant.)

## Invariants

| Invariant | Meaning | Satisfied by / test anchor |
|---|---|---|
| **No lockout** | A denied deployment always has a credential-less way back to SSO | Decision 9 instance license key; integration test: org license expired + no SMTP + SSO-only users → set `LANGWATCH_LICENSE_KEY`, restart, SSO works, zero login |
| **No SSO-account takeover** | No endpoint attaches/sets a password on an email that has an SSO-only account, in any gate state | Decision 4 credential-mutation row always blocked; unit + integration test attempting `/sign-up/email` and `/set-password` against an existing SSO email while `DENY` |
| **Fail-closed both sides** | A gate eval error opens *nothing* — not SSO, not email login | `UNKNOWN` column is 403/403/blocked; unit test with throwing repository |
| **Paying self-hosted: zero change** | ≥1 valid license → SSO works as today, password routes unusable | Decisions 3+4; integration test with seeded license |
| **SaaS: zero platform change** | `IS_SAAS=true` short-circuits platform gate; password routes stay unmounted | Decision 4 boot formula; unit test |
| **No signature risk** | Already-issued licenses validate byte-identically | No schema change (Decision 1); existing backward-compat test untouched |
| **Live flip** | License activation/removal changes SSO without restart | Request-time enforcement + cache invalidation; integration test |
| **Sessions survive** | Gate never invalidates existing sessions | Decision 8; migration test |

## Schema

No database migration. No license payload schema change. One env var, one new module, plus call-site edits:

```ts
// langwatch/src/server/sso/sso-gate.ts
export async function canPlatformSSO(): Promise<boolean>;          // IS_SAAS || validInstanceLicense() || anyOrgHasActiveLicense(); 60s cache; UNKNOWN→false
export async function canOrgSSO(organizationId: string): Promise<boolean>;
export async function resolveAuthProvider(): Promise<string>;     // coerces NEXTAUTH_PROVIDER → "email" when platform gate denies
export function invalidatePlatformSSOCache(): void;               // called by licenseHandler on store/remove
```

```js
// langwatch/src/env-create.mjs — additive, optional
LANGWATCH_LICENSE_KEY: z.string().optional(),
```

Gate sites (implementation order):

| # | Surface | File | Denied behavior |
|---|---|---|---|
| 1 | `publicEnv` provider exposure | `src/server/api/routers/publicEnv.ts:24` | report `"email"` via `resolveAuthProvider()` |
| 2 | Better Auth `before` hook — SSO + email-route truth table | `src/server/better-auth/index.ts:514-543` (extend; key off gate, not `env.NEXTAUTH_PROVIDER`) | per truth table; **enumerate legacy `/callback/auth0`,`/callback/okta`** |
| 3 | `emailAndPassword.enabled` boot flag | `src/server/better-auth/index.ts:375` | `NEXTAUTH_PROVIDER === "email" || !IS_SAAS` |
| 4 | `ssoDomain` auto-join + provider match | `src/server/better-auth/hooks.ts:115, 253-269, 344` | treat as no-match (Decision 11) |
| 5 | Backoffice `ssoDomain`/`ssoProvider` writes | backoffice PATCH path | 403 |
| 6 | `SsoProvider` CRUD (future) | PR #4416 routers | 403 — must land with that PR |

## Rejected alternatives

- **`enableSso: z.boolean().optional()` license field, absent=true** — works, stays available later; rejected for v1 (binary needs no schema/generator/template change and sells the same thing now).
- **`issuedAt`-cutoff default / batch re-issuance** — magic constant / operationally expensive long tail.
- **Wire `sendResetPassword` + forgot-password UI as the recovery path** — the v1 assumption; rejected because SMTP-less installs still brick and it adds a new auth+email surface to an already-large PR. Instance license key (Decision 9) recovers without SMTP or login.
- **Grandfather: never deny credential-less installs** — leaves the env-var bypass open for exactly the installs likeliest to abuse it; "works until someone sets a password" is incoherent.
- **Enterprise-IdPs-only scope (social free)** — market-norm but two provider classes + arbitrary boundary; overruled for one rule.
- **Registration-time gating (boot check + restart)** — better-auth static config made this restart-bound; request-time strictly dominates.
- **Hard-block explainer screen / grace-nag denied mode** — bricks SSO-only installs / leaves bypass open.
- **Path-prefix middleware on `/oauth2/*`** — misses the legacy `/callback/auth0|okta` rewrite (F2); enforce in the `before` hook instead.
- **Single fail-closed flag** — folding "fail closed for SSO" onto a two-sided guard opens email/password on DB blips (F3); the three-state truth table prevents it.
- **Server-logs-only telemetry** — considered to avoid re-creating the limit-tied analytics pattern PR #4480 removed; rejected in v3 because a low-volume, deliberate gate signal is worth the sales/abuse visibility, unlike the high-volume `limit_blocked` event.

## Consequences

**Positive**
- The four-env-var free-SSO bypass is closed with one binary rule; zero signature/compat risk; zero behavior change for every paying customer.
- License changes take effect live; the instance license key gives a deterministic, SMTP-free, login-free recovery and bootstrap.
- One module owns the rule; `env.NEXTAUTH_PROVIDER` reads centralized and lintable.

**Negative**
- **OSS installs using Google/GitHub sign-in lose that method on upgrade** (coerced to email mode). Needs a loud changelog + release note spelling out the `LANGWATCH_LICENSE_KEY` recovery and the "sign up a fresh admin, activate license" path. Largest user-facing cost; accepted deliberately.
- SSO is bundled with "any paid plan" until the optional field is added later (a second PR + generator change).
- Password sign-in/up routes become mounted-but-runtime-guarded on self-hosted SSO deployments; the SSO-bypass protection moves from static (unmounted) to runtime (truth table). Credential-mutation routes stay blocked in all states, so the takeover surface does not open — but the guard is now load-bearing and must be covered by the takeover invariant tests.
- `usePublicEnv` caches `staleTime: Infinity`: after activating a license, the admin must hard-reload to see the IdP button (stale *grant*, red-team F8). Server guard is authoritative; document "reload after activation" in the release note.

**Neutral**
- Per-org gate adds one primary-key license lookup inside hooks that already query the org row.
- CI/e2e fixtures that assume an ungated static gate must be updated — beyond the env-var grep, the e2e auth-regression harnesses (`e2e/auth-regression/*`, `*sso-smoketest*`) exercise `/sign-up/email` and SSO flows directly and change behavior under the runtime guard (red-team F10). Audit set: `rg -l 'NEXTAUTH_PROVIDER.*auth0' langwatch/` **plus** the e2e auth harness files.

## Open questions

| Question | Owner | Status |
|---|---|---|
| Expiry grace period (14–30d + banners) | Sergio | Deferred — follow-up issue after v1 |
| `sso-orphan-user-linking` re-heals a denied-state mis-placed signup on later login (Decision 11) | Sergio | **Verify during implementation** — if it does not self-heal, denied-state company-domain signups need explicit re-placement, not silent fallthrough |
| PR #4416 `SsoProvider` CRUD gate (site #6) | PR #4416 owner + Sergio | Coordination — helpers land here; that PR must call `canOrgSSO` before merge or immediate fast-follow |
| SaaS support enabling SSO for an org mid-Stripe-webhook-propagation | Sergio | Edge case — existing platform-admin override covers it; verify |

## Revisions

- **v1 (2026-06-12)** — Initial ADR. Round 1 locked: binary activeness (no `enableSso` field — refines the prior analysis, which rejected the field for lack of a pickable default; deferred instead); all non-email providers gated; coerce-to-email denied UX. Round 2 locked: no expiry grace in v1; SaaS per-org gate requires a paid plan; server-logs-only telemetry; ADR in-repo. Framing: all SSO surfaces under one flag; forcing function = PR #4480 repositioning; blast radius = login lockout (max rigor); constraints = no re-issuance, SaaS untouched, additive-only schema, ships on PR #4480.
- **v2 (2026-06-13)** — Red-team (devils-advocate) folded in; resolved a BLOCKER and three MAJOR security holes, all verified against the code:
  - **F1 (BLOCKER):** the v1 "recover via password reset" path does not exist (`sendResetPassword` unconfigured, no forgot-password UI, SMTP optional) — so coerce-to-email *alone* bricked SSO-only installs, violating the No-lockout invariant. **Fix:** added the `LANGWATCH_LICENSE_KEY` instance license key as the credential-less recovery/bootstrap path (new Decision 9; gate formula in Decisions 1/5; No-lockout invariant rewritten).
  - **F2 (MAJOR):** the legacy `/callback/auth0`,`/callback/okta` rewrite would slip past an `/oauth2/*` guard. **Fix:** enforce in the `before` hook; legacy callbacks added to the gated-paths set (Decision 3, Constants, gate site #2).
  - **F3 (MAJOR):** a single fail-closed flag opens email/password on any DB blip. **Fix:** three-state gate (`ALLOW`/`DENY`/`UNKNOWN`) + route truth table; email routes open only on definitive `DENY` (Decision 4, Constants, Fail-closed-both-sides invariant).
  - **F4 (MAJOR):** denied-state password routes could plant a credential on an SSO-only account (takeover). **Fix:** credential-mutation paths blocked in *every* gate state when SSO-capable; the existing `before`-hook block keyed off the runtime gate, not `env.NEXTAUTH_PROVIDER` (Decision 4, No-takeover invariant).
  - **F5 → Decision 10** (multi-org instance-IdP grant documented as deliberate); **F6 → Decision 1** ("active" = `validateLicense`, never the `licenseExpiresAt` column); **F9 → Decision 11 + Open Questions** (denied `ssoDomain` fallthrough + mandatory self-heal verification); **F8/F10 → Consequences** (stale-grant reload note; e2e fixture audit).
- **v3 (2026-06-15)** — Reversed the telemetry fork in Decision 7: logs **plus** a 100%-sampled `sso_gate_denied` PostHog event (`{ surface, reason }`), restoring the original analysis's recommendation. Rationale: a low-volume gate-denial signal is worth the abuse-detection + sales-lead visibility, and is materially different from the high-volume limit-tied event PR #4480 removed. No other decision affected.

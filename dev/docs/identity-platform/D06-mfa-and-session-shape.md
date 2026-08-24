# D06 — MFA (TOTP) + session shape + Principal-aligned impersonation

Epic: `../identity-platform-redesign.md` · Plan: `delivery-plan.md` · Wave 3 · Depends on: D03 · Flag: `MFA_ENROLLMENT_OPEN` · Specs: `specs/identity/mfa-and-session-shape.feature`

# Overview

Adds MFA (TOTP + backup codes, never SMS) with an event-sourced enrollment aggregate, extends sessions with identifier/MFA claims, and moves impersonation off the legacy `Session.impersonating` JSON onto the authz `Principal {actor, subject}`.

**Nobody is signed out to land this** (decided 2026-08-24, superseding the fleet-wide revoke this document originally proposed). The three session columns land **nullable**. A session that cannot prove `amr` is not untrustworthy — it is untrustworthy *under a policy that asks about `amr`*, and at deploy no organization has `mfaRequired` on, so the only reader of the column does not exist yet. Sessions therefore end where the policy begins: when an org admin turns `mfaRequired` on, **that organization's** sessions that cannot prove a second factor are stepped up or revoked, right then. That is a deliberate act by the person who chose it, scoped to the people they administer, and it is the shape `maxSessionDurationDays` already has (`specs/ai-gateway/governance/sessions-and-devices.feature` — tightening a policy revokes the sessions that no longer satisfy it).

The only deploy-time revoke is sessions holding a non-null legacy `impersonating` value: LangWatch operators only, a handful of rows, and the payload is being deleted underneath them. They re-impersonate in one click. **D06 is therefore no longer a one-way door**, and its rollback is the flag like every other deliverable's.

# Requirements

- `twoFactor` plugin (in better-auth core) for protocol; hand-written Prisma model matching the plugin schema: `TwoFactor` (secret, backupCodes, userId, verified, failedVerificationCount, lockedUntil) + `User.twoFactorEnabled boolean @default(false)`.
- `MfaEnrollment` aggregate in the identity pipeline. The `twoFactor` plugin's table writes arrive through the identity adapter (R10) like every other model, with ceremony context stamped by the two-factor endpoints (`/two-factor/enable`, `/verify-totp`, `/disable`, `/generate-backup-codes`, `/verify-backup-code`); protocol failures emit events too:

```mermaid
stateDiagram-v2
    [*] --> PENDING : enroll (TOTP secret issued)
    PENDING --> ENABLED : first code confirms
    PENDING --> EXPIRED : 24h wake, never confirmed
    ENABLED --> DISABLED : password+TOTP, or org-admin (audited)
```

- Backup codes one-time-use (consumption is an event). **At rest they are whatever the plugin does with them, and in better-auth 1.6.23 that is symmetric encryption, not a hash** (`two-factor/backup-codes`: `symmetricEncrypt`/`symmetricDecrypt`). Do not write a test asserting a hash; the invariant that actually holds and is worth pinning is that no read returns a usable code and no event carries one.
- `Organization.mfaRequired boolean`; policy evaluated at session mint and at step-up. Step-up screen.
- Session additive columns, all **nullable**: `identifierId`, `amr string[]`, `mfaVerifiedAt datetime`. Per-identifier session revocation (ops surface action from D05 consumes this). Turning `mfaRequired` on for an org steps up or revokes that org's sessions that cannot prove a second factor; nothing else revokes anything.
- Impersonation: sessions carry `{actor, subject}` into the authz Principal; actor must hold `mfaVerifiedAt` when the subject's org policy demands; both recorded on every decision (engine behavior — this deliverable supplies the claims). Legacy `Session.impersonating` JSON path deleted.
- Plugin protocol secrets (TOTP secrets, backup codes) live in plugin tables, encrypted/hashed, never in events.

# Data structures

Session, additive columns (row-truth — sessions never enter the event flow, R12):

```text
Session
  + identifierId   string    which Account row minted this session
  + amr            string[]  authentication method references, e.g. ["pwd","otp"] · ["saml"] · ["phw"]
  + mfaVerifiedAt  datetime? set by TOTP/backup-code step-up; policy checks read it
  impersonating (JSON)       deleted — {actor, subject} ride the authz Principal
```

`MfaEnrollment` events (`tenantId = userId`; TOTP secrets and backup codes never appear — they live hashed/encrypted in the `TwoFactor` plugin table, row-truth):

```jsonc
// lw.identity.mfa_enrolled        { userId, enrollmentId, method: "totp" }         → PENDING
// lw.identity.mfa_confirmed       { userId, enrollmentId }                          → ENABLED
// lw.identity.mfa_enrollment_expired { userId, enrollmentId }                       → 24h PM wake
// lw.identity.mfa_disabled        { userId, enrollmentId, actor, via: "password+totp" | "org-admin" }
// lw.identity.backup_code_consumed { userId, enrollmentId, codeIndex }              → one-time-use proof
// lw.identity.mfa_verification_failed { userId, enrollmentId, failedCount }         → lockout evidence
```

# Out of Scope

- Passkeys (D07). Open Q4 is **decided**: `amr: ["phw"]` satisfies `mfaRequired` — see D07 for the reasoning. An org-level "hardware-bound keys only" refinement is out of scope until somebody asks.
- SMS anything. WebAuthn as an MFA second factor (passkeys are first-factor here).
- `mfaRequired` rollout UX niceties (grace window vs immediate step-up — "still left to think about").

# Research

- better-auth 1.6.23: `twoFactor` is built in; plugin migrations are Kysely-only ⇒ hand-written Prisma models; `databaseHooks` don't fire for plugin tables — moot under R10: the identity adapter sees plugin-table writes uniformly.
- Session today: PG + Redis dual-write, 30-day TTL, `impersonating` JSON. Two things to fix while in there: the Prisma column is `impersonating Json?` while better-auth's config declares the same field `{ type: "string" }` (`src/server/better-auth/index.ts`) — they disagree today, and the disagreement dies with the column. And `storeSessionInDatabase: true` is currently justified *by* impersonation reading the DB row directly; re-justify or drop it when the JSON path goes.
- The `twoFactor` plugin's own table already carries `failedVerificationCount` and `lockedUntil`, so lockout is the plugin's, not ours to build. Its error vocabulary distinguishes `INVALID_CODE` from `INVALID_BACKUP_CODE`; our boundary deliberately collapses both to one `identity_mfa_code_invalid` so the endpoint is not an oracle for which check failed.
- Corpus-audit spec impacts: `phase-1-better-auth-config.feature:150-168` (locks in legacy impersonating — retire, replace with `{actor, subject}` scenarios). **The line range this document originally cited, `:119-137`, is wrong** — that block is the `DIFFERENT_EMAIL_NOT_ALLOWED` guard and the SSO domain-join scenarios. Note also `:166`, inside the same block: "only genericOAuth is present in the plugins array" — registering `twoFactor` breaks it, so it retires with the pair. `sessions-and-devices.feature` (inventory gains `identifierId`/`amr`; `maxSessionDurationDays` is the precedent for policy-tightening revocation, not a conflict with it); anchors that survive: `impersonation-banner.feature`, `dejaview-impersonation-access.feature` (already conceptually actor/subject), `backoffice-user-impersonation-reason.feature` (reason requirement inherited), `password-reset.feature:90-93` (revoke-all on reset — consistent with per-identifier revocation).

# Technical Plan

1. Prisma models + plugin registration; adapter routing entries for the twoFactor models + ceremony-context stamps on the two-factor endpoints.
2. MfaEnrollment aggregate + `mfa_enrollments` projection; 24h expiry wake via process manager.
3. Step-up screen + policy check at session mint.
4. Session migration (additive nullable columns — no session revoked). The `mfaRequired` turn-on path steps up or revokes that org's unproven sessions as part of the policy change.
5. Impersonation rewrite: mint sessions with `{actor, subject}` claims; delete the `impersonating` JSON path; banner/stop endpoints repointed.
6. ADR-4: `amr` semantics (Open Q4 answered: `["phw"]` satisfies the policy), and why no fleet-wide revoke is needed.
7. Gherkin specs — **written 2026-08-24**: `specs/identity/mfa-and-session-shape.feature`, 51 scenarios, `@unimplemented` until bound (enrollment, backup codes, step-up and org policy, policy turn-on, lockout, session shape, impersonation, failure copy, the flag).

# Exit gate / rollback

- **Exit:** enroll → challenge → backup-code → disable round-trips; org policy enforced at mint and step-up; lockout verified; every authz decision records actor+subject; the columns land observably inert (no session ended, stepped up or refused while no org requires anything).
- **Rollback:** `MFA_ENROLLMENT_OPEN` off. Nothing here is irreversible: the columns are additive and nullable, and the only deploy-time revoke is the legacy impersonating sessions, which is one re-click for the operators it touches.

# Security Concerns

- Disable requires password+TOTP, or org-admin action with audit event.
- Impersonation cannot bypass MFA policy — the actor's `mfaVerifiedAt` is checked when policy demands.
- Legacy sessions are not destroyed. They cannot prove `amr`, and under `mfaRequired` that is exactly why they are stepped up or revoked — at the moment the policy is turned on, by the admin who turned it on, for that org alone.
- Lockout parameters (`failedVerificationCount`, `lockedUntil`) tuned and tested.

# Open Questions

- ~~(Epic 4) does passkey `amr: ["phw"]` satisfy org MFA policy?~~ — **decided 2026-08-24: yes.** A passkey is possession-based and phishing-resistant, which is strictly stronger than TOTP against the attack `mfaRequired` exists to stop. A synced software passkey is weaker than a hardware-bound one and still at least as strong as a typed code, so it does not change the answer. Reasoning and scenarios live in `specs/identity/passkeys.feature`; the deferred "hardware-bound keys only" org refinement is noted there as out of scope.
- How often a session that has proven a second factor is asked again (a freshness window on `mfaVerifiedAt`) is **not decided here** and nothing in the spec assumes an answer. The requirement is evaluated at session mint and at step-up, and that is all.

# D07 — Passkeys

Epic: `../identity-platform-redesign.md` · Plan: `delivery-plan.md` · Wave 3 · Depends on: D03 (picker hook point) · Flag: `PASSKEYS_ENABLED` · Specs: `specs/identity/passkeys.feature`

# Overview

Passkeys become first-class identifiers: WebAuthn ceremonies via the official plugin, protocol state in the plugin's table, and mirror rows in `Identifier` so the identifiers model stays conceptually uniform ("how does this person sign in" shows passkeys alongside everything else).

# Requirements

- New dependency `@better-auth/passkey@1.6.23` (pins to core; pulls `@simplewebauthn/*`).
- Hand-written Prisma model matching the plugin schema: `Passkey` (name, publicKey, userId, credentialID, counter, deviceType, backedUp, transports, aaguid).
- Mirror rows: `Identifier` rows with `provider="passkey"` keyed on the credentialID, maintained by the fold from passkey-ceremony events (pure event-truth, per the D01 truth split).
- Passkey table writes arrive through the identity adapter (R10) like every other model; ceremony context is stamped by `/passkey/verify-registration`, `/passkey/verify-authentication`, `/passkey/delete-passkey`. The plugin's `registration.afterVerification`/`authentication.afterVerification` callbacks are pre-write — used for gating/enrichment only, never as the event source.
- Platform and cross-platform authenticators; discoverable-credential (username-less) sign-in where supported.
- Router integration: passkey appears in the uniform method picker (hook point left by D03).
- Sessions minted via passkey carry `amr` including `phw` (phishing-resistant), and **that satisfies an org's `mfaRequired`** — Open Q4, decided 2026-08-24 (below).

# Open Q4 — decided: a passkey satisfies `mfaRequired`

**Decided 2026-08-24. `amr: ["phw"]` counts, and no step-up is asked for.**

The reasoning, in one paragraph so nobody re-opens it. `mfaRequired` exists to stop an attacker who has the password. A passkey is possession-based, so it clears that bar on its own; and it is phishing-resistant, so it also clears a bar TOTP does not — a convincing website can talk somebody through reading a code off their screen, and cannot talk a browser into signing a challenge for the wrong origin. Requiring a second step on top of a passkey would therefore demand a *weaker* proof in addition to a stronger one, which is theatre.

A passkey synced across a person's devices is genuinely weaker than one bound to a single piece of hardware — the sync provider's account becomes a path to it. It is still at least as strong as a code from an authenticator app, which is itself usually synced, so it does not change the answer.

**Deferred, not refused:** an org-level "hardware-bound keys only" refinement. Nothing here forecloses it — `backedUp` comes off the ceremony and the session already records what was proven, so it is a policy reading a claim that will exist. Build it when somebody asks.

# Out of Scope

- Passkeys as an MFA *second* factor (they're a first factor here). Conditional UI / autofill polish beyond plugin defaults.
- The org-level hardware-bound-keys-only refinement (above).

# Research

- better-auth 1.6.23: passkey is a **separate package**, not in core (verified against the installed copy — its `./plugins/*` exports list `two-factor` but no `passkey`), and `@better-auth/passkey` is **not yet a dependency of anything in the repo**, so D07 opens with an install; plugin migrations Kysely-only ⇒ hand-written Prisma model; plugin tables bypass `databaseHooks` — moot under R10: the identity adapter sees plugin-table writes uniformly.
- Already in place, so D07 adds behavior rather than vocabulary: `packages/identity/src/vocabulary.ts` lists `passkey` as a provider kind, and `signin-routing.ts` already classifies it as a local method. `ADR-117` reserves the picker slot ("password + social + passkey placeholder until D07").
- `specs/auth/phase-1-better-auth-config.feature:166` asserts generic OAuth is the *only* registered plugin. D06 retires that scenario when it registers `twoFactor`; if D07 lands first, it retires it instead.
- Greenfield otherwise — nothing in `specs/` mentions a passkey or WebAuthn today. New `.feature` file: `specs/identity/passkeys.feature` (**written 2026-08-24**, 32 scenarios, `@unimplemented` until bound).

# Technical Plan

1. Dependency + Prisma model + plugin registration.
2. Pipeline mirror-row maintenance (events → lifecycle apply).
3. Picker + settings UI (register, name, delete).
4. Discoverable-credential sign-in path on the router.
5. Round-trip tests on platform + cross-platform authenticators against `specs/identity/passkeys.feature`.

# Exit gate / rollback

- **Exit:** register / sign-in / no-email sign-in / delete round-trips green on platform + cross-platform authenticators; mirror rows consistent with plugin table (replay-parity test covers the `Identifier` projection).
- **Rollback:** `PASSKEYS_ENABLED` off.

# Security Concerns

- Counter/backedUp semantics come from the plugin — don't reimplement ceremony verification.
- Passkey deletion obeys the identifier detach guards (≥1 remaining verified identifier + recovery path).
- A passkey attach is a ceremony by construction — fits the attach-requires-proof invariant.

# Open Questions

- ~~(Epic 4) `amr: ["phw"]` vs org MFA policy~~ — **decided 2026-08-24**, see the section above. Record it in ADR-4 alongside the rest of the `amr` semantics.

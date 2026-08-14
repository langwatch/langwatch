# D07 — Passkeys

Epic: `../identity-platform-redesign.md` · Plan: `delivery-plan.md` · Wave 3 · Depends on: D03 (picker hook point) · Flag: `PASSKEYS_ENABLED`

# Overview

Passkeys become first-class identifiers: WebAuthn ceremonies via the official plugin, protocol state in the plugin's table, and mirror rows in `Account` so the identifiers model stays conceptually uniform ("how does this person sign in" shows passkeys alongside everything else).

# Requirements

- New dependency `@better-auth/passkey@1.6.23` (pins to core; pulls `@simplewebauthn/*`).
- Hand-written Prisma model matching the plugin schema: `Passkey` (name, publicKey, userId, credentialID, counter, deviceType, backedUp, transports, aaguid).
- Mirror rows: `provider="passkey"`, `providerAccountId=credentialID`, maintained by the pipeline from passkey-ceremony events (lifecycle columns owned per the D01 rule).
- `identityEventsPlugin` matchers: `/passkey/verify-registration`, `/passkey/verify-authentication`, `/passkey/delete-passkey`. The plugin's `registration.afterVerification`/`authentication.afterVerification` callbacks are pre-write — used for gating/enrichment only, never as the event source.
- Platform and cross-platform authenticators; discoverable-credential (username-less) sign-in where supported.
- Router integration: passkey appears in the uniform method picker (hook point left by D03).
- Sessions minted via passkey carry `amr` including `phw` (phishing-resistant) — whether that satisfies org MFA policy is Open Q4 (ADR-4).

# Out of Scope

- Passkeys as an MFA *second* factor (they're a first factor here). Conditional UI / autofill polish beyond plugin defaults.

# Research

- better-auth 1.6.23: passkey is a **separate package**, not in core; plugin migrations Kysely-only ⇒ hand-written Prisma model; plugin tables bypass `databaseHooks` ⇒ endpoint hooks are the reliable interception.
- Greenfield — no existing spec coverage; new `.feature` files.

# Technical Plan

1. Dependency + Prisma model + plugin registration.
2. Pipeline mirror-row maintenance (events → lifecycle apply).
3. Picker + settings UI (register, name, delete).
4. Discoverable-credential sign-in path on the router.
5. Round-trip tests on platform + cross-platform authenticators; new Gherkin specs.

# Exit gate / rollback

- **Exit:** register / sign-in / no-email sign-in / delete round-trips green on platform + cross-platform authenticators; mirror rows consistent with plugin table (replay-parity test covers lifecycle columns).
- **Rollback:** `PASSKEYS_ENABLED` off.

# Security Concerns

- Counter/backedUp semantics come from the plugin — don't reimplement ceremony verification.
- Passkey deletion obeys the identifier detach guards (≥1 remaining verified identifier + recovery path).
- A passkey attach is a ceremony by construction — fits the attach-requires-proof invariant.

# Open Questions

- (Epic 4) `amr: ["phw"]` vs org MFA policy — shared with D06, decided in ADR-4.

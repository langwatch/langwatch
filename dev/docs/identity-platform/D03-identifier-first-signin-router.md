# D03 — Identifier-first sign-in router + cutover

Epic: `../identity-platform-redesign.md` · Plan: `delivery-plan.md` · Wave 2 · Depends on: D01 · Flag: `IDENTITY_ROUTER_V2` (shadow → enforce) · **Highest-risk deliverable**

# Overview

Replace the `NEXTAUTH_PROVIDER` one-method front door with identifier-first routing: enter email → normalize → route by verified ACTIVE connection domain → IdP redirect; otherwise a uniform method picker. Self-hosted keeps the single-login case as the priority: one ACTIVE connection ⇒ auto-redirect, with a break-glass local path. Ends account-linking dead ends via auto-link / org-admin-confirm.

# Requirements

- Router reads the `Identifier` projection + domain routing tables (strings until D04; `SSOCONN_ROUTING` takes over after). PG reads only on the hot path. Per-user read fork: resolve the identifier in `Identifier` first and fall back to legacy routing for users whose D01 backfill is not `finalized` — the ledger's cutover-gate discipline, per user.
- Normalization identical to D01 attach-time: lowercase, plus-strip, fold.
- Uniform method picker (passkey placeholder until D07 | password | social): same page, same timing, whether or not the account exists — no user-level existence oracle. Domain-level SSO routing is discoverable by design and accepted. D03 owns this contract and the decision engine; the screens that render it are D13, on the same flag.
- Self-hosted: exactly one ACTIVE connection ⇒ auto-redirect straight to the IdP; deliberate escape hatch `/auth/signin?local=1` (the break-glass binding made real). Env becomes the default method set, not a global gate.
- Cloud: multiple methods simultaneously — ends the `NEXTAUTH_PROVIDER` one-method invariant there.
- SSO callback linking:
  - `(connectionId, subject)` match → sign in.
  - No match, verified email matches existing user, unambiguous (no non-corporate identifiers on the target) → auto-link + audit event.
  - Ambiguous → `LinkProposed`; org admin confirms on the org-admin surface (lands with D05; until then, ops).
  - No match at all → JIT if the connection allows, else deny with guidance.
- `pendingSsoSetup`: reconciled once against identifier data, column dropped.
- ADR-027 amendment: the global `before` hook's path blocking becomes per-method policy on the router. License-gate semantics preserved (SSO requires license; credential paths stay open). Carry over ADR-027's constants table and the `ssoRouteTableCanary.test.ts` discipline — every auth route keeps a reviewed classification.
- Shadow mode: `IDENTITY_ROUTER_V2` shadow-compares every login against the legacy path before the flip.

# Out of Scope

- The screen set itself (D13 — sign-in, sign-up, reset, verification, deny/guidance states; flips with this deliverable on the same flag). Connection management UI (D05), MFA step-up UI (D06 — the router leaves the hook point), passkeys as a picker method (D07), join-request interstitial (D12 — hook point left).

# Research

- Current gate: `src/server/better-auth/index.ts` + `hooks.ts` (domain auto-join, `pendingSsoSetup`, invites); ADR-027:137 explicitly rejected router-level interception ("the `before` hook remains the only correct interception point") because of the legacy `/callback/auth0|okta` rewrite — ADR-3 must show the router covers every gate site ADR-027 enumerated, including that rewrite.
- Corpus-audit spec impacts (see delivery-plan amendment table): `phase-1-better-auth-config.feature` (NEXTAUTH_PROVIDER matrix, ssoProvider matching, pendingSsoSetup — retire), `password-reset.feature:144-148` (cloud-mode rejection — Open Q9), `sso-orphan-user-linking.feature` (generalize into the auto-link rule; reconcile its "unverified orphan cannot be hijacked" with R8's login-never-gated), `signup-does-not-strand-an-account.feature` (anchor; enumeration tension = Open Q12), `sso-license-gating.feature` (mechanism amend; restart semantics = Open Q11), `sso-oidc-providers.feature` (Cognito/OneLogin `NEXTAUTH_PROVIDER` mounting, :24/:32 — port to the self-hosted default method set; discovery-document configuration survives), `user-deactivation.feature:134-143` (stale NextAuth wording sweep; behavior anchor survives).

# Technical Plan

1. Router module: email → routing decision (pure function over PG reads; unit-testable; decision logged with reason codes for the ops surface).
2. Routing-decision contract consumed by D13's screens (decision + reason codes); timing-normalization requirements pinned by contract tests.
3. Auto-link / LinkProposed commands (identity pipeline); audit events with before/after.
4. Break-glass local path bound to break-glass bindings (bindings land fully in D05; interim: platform-ops-granted).
5. `pendingSsoSetup` reconciliation job + column drop.
6. Shadow comparison + bake; flip; legacy path deletion.
7. ADR-3 (router + self-service, spans D03–D05).

# Exit gate / rollback

- **Exit:** zero unexplained shadow mismatches over the bake window; sign-in success ≥ baseline (dashboard live before flip).
- **Rollback:** flag off — legacy path intact until deletion at bake end.

# Security Concerns

- Enumeration: uniform page/timing; the only new probe surface is the router endpoint — verify it's covered by better-auth's existing rate limiter (acceptance check).
- Wrong-human linking: auto-link only when unambiguous; every link emits before/after audit events.
- Break-glass path: bound to break-glass bindings, audited, rate-limited — it is the obvious target when a customer IdP is up.

# Open Questions

- (Epic 9) password reset availability in cloud/SSO mode under the uniform picker.
- (Epic 11) license-gate timing: startup-decided vs per-request evaluation.
- (Epic 12) sign-up enumeration vs no-oracle scoping.

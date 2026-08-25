# D05 — Self-service SSO onboarding + identity surfaces

Epic: `../identity-platform-redesign.md` · Plan: `delivery-plan.md` · Wave 3 · Depends on: D04 + **authz precondition checklist (hard)** · Flag: `SELF_SERVE_SSO` (per-org)

# Overview

Enterprise SSO onboarding stops being a support ticket. Org admins register and verify their own connections in Settings; LangWatch ops approves domain claims; and both support surfaces ship — the platform-ops identity lookup (the designated replacement for DB surgery) and the org-admin surface (link confirmations, member-identifier view). Permissions are real registry entries from day one — no seam.

# Requirements

**Self-service onboarding** (Settings → SSO, gated by `sso:manage`):

- Full lifecycle self-service: register connection (OIDC; SAML per the D04 engine decision) → claim domain → ops approval → DNS TXT ceremony → test login → activate. Self-hosted: license-bound ops token path instead of DNS.
- DNS TXT: `VerificationToken`-style token; hash stored in the event, never the raw token.
- Break-glass bindings: expiring `sso:manage` grants via `grants.attach` with expiry; process-manager warning wakes at 14/7/1 days; renewal via platform-ops. Activation guard (≥1 live binding) now fully self-serve.
- Connection-scoped SCIM token issuance (tokens consumed by D08's reroute).
- Auto-redirect behavior for self-hosted sole-connection deployments (env default; per-connection override per Open Q6).

**Registry permissions (authz API, no seam):**

- `sso:view`, `sso:manage`, `scim:view`, `scim:manage` registered in `server/authz/registry.ts` (org-scope only, org-exclusive like governance).
- IT-admin custom role = `CustomRole` row holding only those permissions, bound at org scope.
- All tRPC gating via `.permission()`/`authz.require`; all UI gating via `useCan`/`RequireCan`.

**Surface 1 — platform-ops identity lookup** (route tree under `ee/admin/`, platform-ops-gated):

- Cross-org: input any email → routing decision (with reason codes from D03), identifiers per user (all states, all users owning fragments), last N identity events, pending `LinkProposed`s, outstanding invites with expiry, pending join-requests.
- The lookup **read** is itself guarded: every query passes the platform-ops authorization check and writes an audit-log entry (who resolved which email, when) — a cross-org read is never unaudited, command or not.
- Every action a guarded command: `confirmLink`/`rejectLink`, `detachIdentifier` (guarded), `resendInvite`/`extendInvite`, `revokeSessions(userId | identifierId)`, `approveDomainClaim`/`rejectDomainClaim`.
- Ships here as the safety net for self-serve onboarding — this is what kills DB surgery.

**Surface 2 — org-admin surface** (org Settings, separate routes/queries):

- Pending link confirmations for the org's members; member-identifier view ("how does each person sign in"). (Join-request approvals arrive with D12; the invitation management shipped at D11 into the existing members UI is absorbed onto this surface.)
- Org-scoped at the data layer — a bug here cannot expose cross-org data.
- Gated: `sso:manage` for connection/link actions; member-management permission for the rest.

# Out of Scope

- Join-request approvals (D12 adds them to surface 2) and the invitation panels absorbed from D11.
- Auth0 migration wizard (D09 reuses this machinery).
- The IA merge with the authz Access surface (design pass later — "still left to think about").

# Research

- Closed-unmerged self-serve plugin PR #4416 — read for pitfalls before building the UI.
- ADR-027 license gating must remain enforced on every new route (route-table canary discipline carried over per D03).
- Corpus-audit: no existing specs cover these surfaces — new `.feature` files to write (org-admin panels, ops actions, connection self-service lifecycle).

# Technical Plan

1. Registry entries + IT-admin role seed; permission checks on all new routes.
2. Onboarding wizard UI (org Settings → SSO) driving the D04 commands; DNS TXT polling via process-manager wakes; test-login step records the activation event.
3. Break-glass binding issuance/expiry via `grants.attach` + PM wakes.
4. Ops lookup: read models over the identity projections + event log queries (last-N events per user/identifier); action buttons dispatch the guarded commands.
5. Org-admin surface: org-scoped queries only; shared command handlers with the ops surface, nothing else shared.
6. SCIM token issuance scoped to `connectionId` (new column; newly issued tokens are connection-scoped, legacy tokens keep their organization scope until rotated or reissued — no backfill assigns them a connection — consumed in D08).
7. New Gherkin specs for both surfaces + onboarding lifecycle.

# Exit gate / rollback

- **Exit:** a new enterprise customer onboards with exactly one LangWatch action (the approval click); the ops surface resolves a real support case end-to-end without DB access.
- **Rollback:** `SELF_SERVE_SSO` per-org flag; surfaces are additive.

# Security Concerns

- Domain claim abuse: ops approval on every claim; DNS proof before routing; disputes from event history.
- Surface separation is structural (routes, queries, scopes), not cosmetic.
- Break-glass bindings expire by default; renewal is deliberate and audited.
- Ops actions are commands with guards and audit events — no raw mutations.

# Open Questions

- (Epic 6) per-connection auto-redirect override.
- (Epic 2) approval-queue staffing/SLA — measure queue latency from day one.

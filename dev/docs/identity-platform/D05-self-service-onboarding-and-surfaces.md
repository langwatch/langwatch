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

- `sso:view`, `sso:manage`, `scim:view`, `scim:manage` registered in `packages/authz/src/registry.ts` (org-scope only, org-exclusive like governance). The registry is a shared package, not app code: `server/authz/registry.ts` does not exist and never did — app-side authorization (the tRPC middleware, the engine gate, the grants runtime) lives at `server/app-layer/authz`, and it consumes the registry rather than holding it.
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

# Revision (2026-08-24) — three tiers, in priority order; SAML out

Requirements above are reshaped by the specs written for this deliverable
(`specs/identity/sso-onboarding-tiers.feature`,
`specs/identity/platform-ops-identity-lookup.feature`,
`specs/identity/org-admin-identity-surface.feature`). Four decisions, none of
them re-opened by the implementation:

1. **SAML is out of D05.** Self-serve is OIDC only. D04's aggregate is
   protocol-agnostic on purpose, so SAML lands later as a port implementation
   and the engine choice (ADR-117's named debt) moves to D09, where a named
   customer's connection defines the requirement instead of a guess.

2. **Onboarding is three separable tiers, built in this order.** Each tier
   ships alone with green specs; a later tier adds a path, never a
   precondition.

   - **Tier 1 — ops-assisted (cloud).** A LangWatch operator registers,
     claims, approves, **attests** and activates a customer's connection from
     the back office in one sitting, with no round-trip to the customer at
     all — the only thing left that needs them is somebody completing a test
     sign-in, which is the entire point of a test sign-in. Attestation is a
     D04 amendment (below). This is the bulk of the value: it is what makes
     cloud onboarding easy for *us*, and it is the safety net that ends DB
     surgery.
   - **Tier 2 — self-hosted self-serve, licence-gated.** A self-hosted
     customer cannot reach our operators at all, so they self-serve or they
     have no SSO. **Their enterprise licence is the authorization**: no
     domain-claim queue, no LangWatch approval step, no DNS TXT ceremony. The
     licence-bound path (`license-token`, already in D04's ceremony
     vocabulary) replaces all of it, which makes tier 2 genuinely simpler
     than tier 3 rather than harder.
   - **Tier 3 — cloud self-serve.** Domain claim, DNS TXT proof, and the ops
     approval queue. Last, separable, and the only tier carrying the abuse
     surface. It ships behind the same `SELF_SERVE_SSO` per-org flag and may
     ship late or not at all — Open Q2 (queue staffing and SLA) is unresolved
     and gates it, not the other two.

3. **The permission registry is `packages/authz/src/registry.ts`.** Corrected
   above; `server/authz/registry.ts` never existed.

4. **D04 gains a fourth verification method, `operator-attested`** (amended
   into `D04-sso-connection-aggregate.md` and
   `specs/identity/sso-connection-lifecycle.feature`). It replaces the DNS
   proof for tier 1 and **never** the ops approval: the claim is still
   approved by an operator, which is where the trust decision always lived,
   so an attested domain is exactly as trustworthy as that approval and no
   more. Requestable only by a platform operator, so tier 3 keeps `dns-txt`
   (the tier where a customer proves a domain we have no other reason to
   believe is theirs) and tier 2 keeps `license-token`. An attestation does
   not expire and there is no DNS upgrade path — the reasoning is in the D04
   amendment, and the price of it is that an attested domain is permanently
   labelled as attested wherever it is read.

5. **The ops lookup's READ is a guarded, audited command surface, not a
   query.** Resolving an address across organizations writes an audit record
   naming the operator, the address and the time, whether or not anything is
   then changed.

# Open Questions

- (Epic 6) per-connection auto-redirect override.
- (Epic 2) approval-queue staffing/SLA — measure queue latency from day one.

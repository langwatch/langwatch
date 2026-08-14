# D09 — Auth0 customer migrations

Epic: `../identity-platform-redesign.md` · Plan: `delivery-plan.md` · Wave 4 · Depends on: D05, D08 · Rollback is structural: both-connections-active grace · **customer-paced, per tenant — slow by design**

# Overview

Enterprise customers move off the Auth0 broker onto direct OIDC connections, one tenant at a time, driven by a **migration wizard** in org settings (assumed frontend shape — Open Q7 — pending validation against the Notion comment). Grace with both connections active is the rollback. A temporary **legacy callback shim** (R9) keeps customer-pinned Auth0 redirect URIs working through grace, so no customer is ever forced to reconfigure their IdP mid-migration.

# Requirements

**Migration wizard** (org Settings → SSO; reuses D05 machinery):

- **Step 0 — detect:** the org has a grandfathered legacy (Auth0-broker) connection → "Migrate your SSO" banner. Ops can also enroll an org from the ops surface.
- **Step 1 — create direct OIDC connection:** pick IdP vendor (Okta / Entra / Google Workspace cheat sheets), enter issuer/clientId/secret; we display the redirect URIs to register — with the explicit note that the legacy URI keeps working via the shim, so there's no IdP-side cutoff moment.
- **Step 2 — domains:** already verified (grandfathered at D04) — no re-verification.
- **Step 3 — test login** as the org admin.
- **Step 4 — activate alongside legacy** → grace begins.
- **Step 5 — progress view:** % of active users linked (link-on-login: unambiguous → auto-link; ambiguous → org-admin confirm), straggler list, one-click nudge emails.
- **Step 6 — SCIM repoint** if the customer uses SCIM (D08 connection-scoped tokens; the Auth0 log-stream webhook is retired for this customer).
- **Step 7 — teardown:** enabled at 100% of active users linked (admin override possible, standard guards apply): detach legacy identifiers → teardown legacy connection.

**Nudges + exception queue:**

- In-app banner during grace ("18 of 42 users migrated"), periodic email to org admins, CS escalation after N days without progress.
- Ops-surface exception queue: stuck customers, ambiguous links, dormant users (contractors, service users who never log in) — guarded ops actions: extend grace, force-detach with override + audit event.

**Legacy callback shim (R9):**

- `/api/auth/callback/auth0` (and `/okta`) stay mounted as thin shims translating to the matching legacy connection's handler while any legacy connection is ACTIVE. The shim never accepts credentials itself — translation only, no new auth surface.
- Per-org shim-hit metric; a customer with zero shim hits and a direct connection is provably clean.
- Deleted at D10, when no ACTIVE legacy connections remain.

**Pacing:** per tenant, no fleet deadline. D10 starts only at zero ACTIVE legacy connections — treat D10 as a program exit criterion, not a scheduled milestone; Auth0 spend continues until then and that's fine.

# Out of Scope

- Auth0 code/config deletion (D10). Non-SSO Auth0 remnants (already migrated off with better-auth).

# Research

- Auth0 today: OIDC provider via genericOAuth; `src/server/auth0/passwordService.ts`; federated logout; SCIM log-stream webhook. SaaS infra: `AUTH0_*` via the opaque `langwatch_secrets` blob (passthrough — no Terraform diff).
- Customer IdP apps pin `/api/auth/callback/auth0` (`specs/auth/auth-signin-flows.feature:46-48`) — the shim exists precisely so this is not a day-one outage.
- The support threads in the epic are the failure modes this wizard must surface instead: every stuck state is visible on the ops surface with a guarded action.

# Technical Plan

1. Wizard UI driving D05's connection commands + progress reads (% linked from identifier data).
2. Comms pack: email templates + per-IdP cheat sheets.
3. Shim + per-org hit metric — must exist **before the pilot activates** (pilot checklist item).
4. Playbook doc (engineering/CS) + exception-queue views on the ops surface.
5. Pilot customer → batches at whatever pace customers move.

# Exit gate / rollback

- **Exit per customer:** all active users linked; quiet grace (no legacy logins for N days, shim hits at zero); teardown event.
- **Program exit:** zero ACTIVE legacy connections.
- **Rollback:** grace *is* the rollback — legacy stays ACTIVE until teardown.

# Security Concerns

- Both-active windows widen attack surface slightly — mitigated by link-on-login audit events and the linking ambiguity guards.
- Legacy identifier detach obeys the standard guards (≥1 remaining verified identifier + recovery path); ops force-detach override is audited.
- Shim is translation-only and logged; it must never become a credential endpoint.

# Open Questions

- (Epic 7) validate the wizard shape against the Notion frontend-flow comment when it surfaces; adjust scope if it contradicts.

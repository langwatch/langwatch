# D09 — Auth0 customer migrations

Epic: `../identity-platform-redesign.md` · Plan: `delivery-plan.md` · Wave 4 · Depends on: D05, D08 · Rollback is structural: both-connections-active grace · **customer-paced, per tenant — slow by design**

> **Amendment 2026-09-03:** `platform/app` is deleted. Auth0 password-change
> handling now lives at
> `packages/features/auth/server/src/services/auth0-password.service.ts`.
> Verify current shape against the tree before treating paths below as live.

# Overview

Enterprise customers move off the Auth0 broker onto direct OIDC connections, one tenant at a time, driven by a **migration wizard** in org settings (assumed frontend shape — Open Q7 — pending validation against the Notion comment). Grace with both connections active is the rollback. A temporary **legacy callback shim** (R9) keeps customer-pinned Auth0 redirect URIs working through grace, so no customer is ever forced to reconfigure their IdP mid-migration.

# What Auth0 is today, and what removes each piece

| Auth0 dependency today                                                 | What retires it                                                            | When                                                |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------- |
| OIDC broker for enterprise SSO (genericOAuth `auth0`/`okta` providers) | Direct per-org `SsoConnection` (OIDC/SAML), one customer at a time         | this deliverable, per tenant                        |
| Front-door screens (Universal Login owned the unauthenticated visuals) | First-party screen set                                                     | D13, at the `IDENTITY_ROUTER_V2` flip               |
| `Organization.ssoDomain`/`ssoProvider` string routing                  | Connection-based routing                                                   | D04 (`SSOCONN_ROUTING`)                             |
| `src/server/auth0/passwordService.ts` (Management API password ops)    | Identifier-model password change (`change-password-auth0.feature` rewrite) | D10                                                 |
| Federated logout                                                       | Direct-connection logout semantics                                         | this deliverable per tenant; code deleted D10       |
| SCIM log-stream webhook                                                | Per-connection SCIM tokens; customers repoint during Step 6                | D08 machinery; per tenant here; webhook deleted D10 |
| Customer-pinned `/api/auth/callback/auth0\|okta` redirect URIs         | The legacy callback shim (R9) through grace; zero-hit metric               | shim deleted D10                                    |
| `AUTH0_*` secrets via the `langwatch_secrets` blob                     | Nothing to replace — removed from the blob                                 | D10                                                 |
| agents-box Playwright QA login via Auth0                               | QA login against the first-party screens                                   | D10                                                 |

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

# Data structures

Per-tenant migration state is a `@langwatch/system-migrations` record (migration name `identity-d09-auth0-cutover`) — the runner's pass re-computes the proof each boot, the ops migrations page shows the fleet, and the operator rollback maps to "extend grace". The rider is **proof-only**: a pass re-verifies and holds (`migrated`), never drives a tenant forward — only the customer moves the work:

```jsonc
{
  "migrationName": "identity-d09-auth0-cutover",
  "tenantId": "org_…",
  "status": "migrated", // work done, held: proof below not yet clean
  "report": {
    "directConnectionId": "ssoc_…",
    "activeUsers": 42,
    "linkedUsers": 18, // link-on-login progress (identifier data)
    "stragglers": ["user_…"], // dormant/contractor accounts for the exception queue
    "legacyLoginsLast14d": 3,
    "shimHitsLast14d": 7, // per-org shim metric (R9)
  },
}
// finalized ⇔ linkedUsers == activeUsers ∧ legacyLogins quiet ∧ shimHits == 0
// finalized is what enables Step 7 teardown; rolled_back pins the org on grace
```

Progress reads are queries over identifier data (`Identifier` rows with `connectionId = <direct>` vs legacy — ADR-116 retires `Account`, so nothing here may read it), not stored counters; the wizard and the report render the same query.

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
- **Rollback:** grace _is_ the rollback — legacy stays ACTIVE until teardown.

# Security Concerns

- Both-active windows widen attack surface slightly — mitigated by link-on-login audit events and the linking ambiguity guards.
- Legacy identifier detach obeys the standard guards (≥1 remaining verified identifier + recovery path); ops force-detach override is audited.
- Shim is translation-only and logged; it must never become a credential endpoint.

# Open Questions

- (Epic 7) validate the wizard shape against the Notion frontend-flow comment when it surfaces; adjust scope if it contradicts.

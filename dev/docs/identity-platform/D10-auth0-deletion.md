# D10 — Auth0 code + config deletion

Epic: `../identity-platform-redesign.md` · Plan: `delivery-plan.md` · Wave 4 · Depends on: D09 program exit (zero ACTIVE legacy connections) · **Program exit criterion — customer-paced, not a scheduled milestone**

# Overview

Auth0 actually dies: provider config, Management API password service, federated logout, SCIM webhook, env wiring, SaaS secrets, the legacy callback shim, and the agents-box Playwright login. Customer migration is deliberately slow and per-tenant (D09); this deliverable starts only when the last legacy connection tears down. This is the program's DONE signal.

# Requirements

- Delete from `platform/app`: Auth0 provider config in `ee/sso/providers.ts`, `src/server/auth0/passwordService.ts`, federated logout, the SCIM Auth0 log-stream webhook, related env wiring.
- Delete the temporary legacy callback shim (`/api/auth/callback/auth0`, `/okta` — R9) once shim metrics show zero traffic and no ACTIVE legacy connections remain.
- Rewrite `specs/settings/change-password-auth0.feature`: the Auth0 Management API scenarios retire; password change becomes an identifier-model operation (which identifier's password, current-password proof) against better-auth native behavior.
- Retire the Auth0 sign-in flow scenarios in `specs/auth/auth-signin-flows.feature` (the pinned legacy callback URI's raison d'être ended with the shim's removal).
- SaaS infra: swap `langwatch_secrets` keys (passthrough blob — no Terraform diff); remove `AUTH0_*` keys.
- agents-box post-deploy Playwright QA: rewrite login to an email/password test user (currently authenticates via Auth0 — breaks the moment the provider goes).
- Env naming: decide Open Q3 (`NEXTAUTH_*` → better-auth-native names) as part of this cleanup.
- Cancel Auth0 spend — only now, not before.

# Out of Scope

- Customer migrations (D09 must be complete first). Any remaining `auth0-legacy`/`okta-legacy` identifier rows — they're tombstoned history, they stay.

# Research

- SaaS infra: Auth0 is dashboard-only (not Terraform-managed); prod/staging receive `AUTH0_*` via the `langwatch_secrets` blob auto-injected as env vars; dev wires `NEXTAUTH_SECRET` explicitly; `modules/agents-box/main.tf` Playwright QA logs in via Auth0.

# Technical Plan

1. Deletion PR(s) with the grep gate below.
2. agents-box QA rewrite + verification deploy.
3. Secrets blob swap (coordinate with deploy).
4. Spec amendments (change-password rewrite, signin-flows retirement).
5. Billing cancellation.

# Exit gate / rollback

- **Exit:** repository-wide `grep -ri auth0` (not just `platform/app` — the deletion scope spans agents-box, specifications, and env wiring too) → changelog and tombstoned history only; the `langwatch_secrets` blob verified to carry no `AUTH0_*` keys; deployment configuration (env wiring, `modules/agents-box/main.tf`) verified Auth0-free; deploy pipeline green; agents-box QA green. **This is the DONE signal.**
- **Rollback:** a tested restore artifact, not "nothing left". Before the deletion PR merges: tag the last Auth0-capable commit (`pre-auth0-deletion`), escrow the `AUTH0_*` secrets outside the blob (ops vault, dated), and prove the tag deploys green in staging. The last fallback (the shim, then the secrets) is deleted only after an observation window — zero shim hits for a sustained window (the shim's own metric, per Security), zero Auth0-attributed sign-in failures, no open customer thread naming a legacy connection. The escrow and tag are retired only once the exit grep has stayed green through a full release cycle after that window; billing cancellation comes last.

# Security Concerns

- Federated logout deletion: confirm session-revocation coverage (D06 per-identifier revocation + ops `revokeSessions`) replaces any logout semantics customers relied on.
- Shim removal is gated on its own usage metric — zero hits for a sustained window, not just "all connections torn down."

# Open Questions

- (Epic 3) env renames during this cleanup or kept for compatibility.

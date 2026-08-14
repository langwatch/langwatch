# D12 — Join requests + domain auto-join (Anthropic-Teams-style)

Epic: `../identity-platform-redesign.md` · Plan: `delivery-plan.md` · Wave 3 · Depends on: D03 (router) + D13 (sign-up interstitial hook) + D05 (org-admin surface hosts approvals) · Flag: `JOIN_REQUESTS`

# Overview

Sign up with a work email, see that your colleagues already have an org, and get in — either by requesting (an admin approves in-app) or, where the org has opted in, by walking straight in on a verified domain match. No invitation needed. The request path is admin-gated, which is what makes it safe without any SSO machinery: worst case is a stranger's request sitting in an admin's inbox. The auto-join path is org opt-in, verified-email-only, and never available on public email domains.

Because this decision now happens **before** workspace creation (D13's interstitial), it is also the fix for orphaned organizations: today every sign-up mints a fresh org, including the thousands of solo workspaces people abandon the moment they join their real one.

# The journey (the case this must cover, end to end)

1. I sign up for LangWatch with `me@acme.com` and verify the email.
2. Before any workspace is created, I see that Acme Corp already exists here ("12 of your colleagues"), with **Join Acme Corp** as the primary action and "create a new organization" as the secondary one.
3. Depending on Acme's `domainJoin` setting:
   - **`request`** — I ask to join; my manager (any org admin) gets an email + in-app notification and approves or rejects; I get notified and land in the org with the default role.
   - **`auto`** — I'm in immediately with the default role; admins are notified it happened.
   - **`off`** — I see nothing about Acme at all; sign-up proceeds to workspace creation as today.
4. At no point has a throwaway organization been created for me unless I explicitly chose "create a new organization" (or no match existed).

# Requirements

Aggregate `join_request` in the identity pipeline; projection `join_requests` (`id, userId, organizationId, domain, state, createdAt, resolvedAt, resolvedByUserId`):

```mermaid
stateDiagram-v2
    [*] --> PENDING : requestJoin (verified email, domain match)
    PENDING --> APPROVED : org admin approves (org-admin surface)
    PENDING --> APPROVED : policy auto-approval (domainJoin = auto)
    PENDING --> REJECTED : org admin rejects
    PENDING --> EXPIRED : 14 days (admin reminder wake at day 7)
    PENDING --> WITHDRAWN : requester cancels
```

Auto-join reuses the same lifecycle: the request is created and immediately approved by policy (`resolvedBy = policy:domain-auto`), so the audit trail and metrics are identical to the admin path.

- **Org setting `domainJoin`: `off` | `request` | `auto`.** Default `request` for cloud self-serve orgs; forced `off` for SSO-connected orgs (their connection's JIT handles it) and for self-hosted (per-org override available). `auto` is opt-in only, admin-set.
- **Matching** (post-verification only): orgs with ≥1 member holding a VERIFIED identifier on the requester's domain (threshold Open Q8), excluding personal orgs, excluding orgs with ACTIVE SSO connections, excluding orgs with `domainJoin = off`. **Public email domains (gmail.com, outlook.com, …) never match** — maintained deny-list; no domain feature exists for them in any mode.
- **Privacy:** org existence/name revealed only after the requester's email is verified, only on domain match, never for personal orgs; member counts coarse ("12 of your colleagues").
- **No role picker:** approval — admin or policy — always grants the org's default role (MEMBER); admins upgrade later. Least privilege by construction.
- **Orphan-org prevention:** the interstitial runs **before** workspace creation (D13's sign-up flow); "join" is the primary action on a match and org creation is the explicit secondary choice. A user with a pending request lands on a "request pending" screen and may still create a workspace deliberately — but never gets one minted silently. Metric: orphaned-organization creation rate (orgs created by users who join another org on the same domain within 30 days).
- **Anti-abuse:** one pending request per (user, org); requests rate-limited like auth endpoints; rejection is silent-ish ("not approved", no reason required); auto-join notifies all org admins after the fact (email + in-app) so a surprising join is visible immediately.
- **Process manager per request:** `JoinRequested` → notify org admins (email + in-app); day-7 reminder wake; day-14 `JoinExpired`. Approval intent (admin or policy) → `grants.attach` → notify requester (email + in-app).
- **UI:** the sign-up interstitial ("Acme Corp — 12 of your colleagues are here. Join / Request to join" alongside "create a new organization"), also shown post-login for existing users, once per domain per user, dismissible (hook point left by D13/D03); approvals live on the org-admin surface (badge + approvals row); the `domainJoin` setting lives in org Settings next to the SSO configuration.

# Out of Scope

- Converting a pending request into a formal invite with team assignments (nice-to-have later). SSO JIT provisioning (belongs to the connection, D04). Cleanup of the orphaned organizations that already exist (Open Q14 — this deliverable stops the bleeding, it doesn't drain the pool).

# Research

- Greenfield — no existing spec coverage; new `.feature` files to write (lifecycle, matching, privacy, anti-abuse, auto-join, join-before-create).
- Motivation: the invitation dead-end support threads — users who should have found their org instead landed in "create personal workspace" flows they couldn't escape. The same flow is why production carries a long tail of orphaned single-user organizations: sign-up creates one unconditionally, and joining your real org later doesn't remove it.

# Technical Plan

1. Projection + events (`JoinRequested`, `JoinApproved`, `JoinRejected`, `JoinExpired`, `JoinWithdrawn`) + matching query over VERIFIED identifiers; policy auto-approval path with `resolvedBy = policy:domain-auto`.
2. Process manager: notifications (incl. after-the-fact admin notification on auto-join), day-7 reminder, day-14 expiry; approval intent → `grants.attach`.
3. Interstitial content into D13's sign-up hook (join-before-create) + post-login variant; org-admin surface approvals panel + `domainJoin` setting.
4. Orphaned-organization metric (creation rate + the 30-day join-elsewhere signal), on the dashboard before the flag flips.
5. New Gherkin specs for the lifecycle, matching rules, privacy, anti-abuse, auto-join, and join-before-create.

# Exit gate / rollback

- **Exit:** request → approve → member round-trip; auto-join round-trip on an opted-in org (and refused on a public email domain); reminder/expiry wakes verified; matching/privacy specs green; orphaned-organization creation rate visibly down.
- **Rollback:** `JOIN_REQUESTS` off.

# Security Concerns

- Request ≠ access — an admin gates every join, except where the org has deliberately opted into `auto`; that path still requires a verified email on a matching non-public domain and notifies admins immediately.
- Public email domains are excluded from every mode — a gmail.com "domain match" must be structurally impossible, not just unlikely.
- Reveal discipline: post-verification only, domain match only, never personal orgs, coarse counts.

# Open Questions

- (Epic 8) matching threshold ≥1 vs ≥2 verified members on the domain. (Lean: ≥1 — behind verification and admin approval anyway; for `auto` mode the lean flips to ≥2 or admin-verified domain, to be settled in the spec.)
- (Epic 14) the orphaned organizations that already exist: sweep, merge tool, or leave them?

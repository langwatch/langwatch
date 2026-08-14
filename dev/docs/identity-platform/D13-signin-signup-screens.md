# D13 — Sign-in & sign-up screens (the first-party auth UI)

Epic: `../identity-platform-redesign.md` · Plan: `delivery-plan.md` · Wave 2 · Depends on: D01 (identifier model); flips with D03 (same flag: `IDENTITY_ROUTER_V2`)

# Overview

Auth0 owned the front-door visuals; retiring it means every screen an unauthenticated person can touch must be rebuilt first-party. This deliverable is that screen set: sign-in, sign-up, method picker, password reset, email verification, and every deny/guidance state — designed as one experience, shipped behind the router flag, with the hook points D06/D07/D12 later fill. It also moves the join-your-team decision to **before** workspace creation, which is where orphaned organizations stop being minted.

# Requirements

**Screen inventory** (each with golden path + failure states in its spec):

- **Sign-in — identifier-first**: email step → routed outcome (IdP redirect, or the uniform method picker: password | social | passkey placeholder until D07). Same page, same timing whether or not the account exists (D03 owns the contract; this UI implements it). Self-hosted sole-connection auto-redirect and the `?local=1` break-glass variant.
- **Sign-up**: email step → verification → method choice (password or social, reusing the picker components). After verification, the **join-before-create interstitial** (hook filled by D12): if the domain matches an org, "join Acme Corp" / auto-join leads and "create a new organization" is the secondary action. An organization is created only when the user explicitly chooses it or no match exists — sign-up stops defaulting into a fresh org nobody will ever use.
- **Password reset**: request + reset screens; availability under SSO/cloud mode per Open Q9; uniform response whether or not the email exists.
- **Email verification states**: sent, verified, expired-link, resend.
- **Deny/guidance states**: JIT-off denial with guidance, wrong-method guidance (points at the method the account actually has), deactivated account, license-gated SSO, suspended connection.
- **Hook points left, not built**: MFA challenge (D06), passkey button + no-email sign-in (D07), interstitial content and matching (D12).
- Consistent with the product design system; no Auth0-hosted pages, assets, or redirects anywhere on the unauthenticated surface.

**Cutover:** the screens ship dark behind `IDENTITY_ROUTER_V2` and appear at the enforce flip together with D03's routing. Shadow mode never renders them (it compares routing decisions only).

# Out of Scope

- Routing logic and auto-link rules (D03). MFA/passkey ceremonies (D06/D07). Join-request matching, privacy and approvals (D12). Org-admin and ops surfaces (D05). The "manage sign-in methods" self-serve settings screen (epic: still left to think about).

# Research

- Today's screens are thin because Auth0's Universal Login carried the weight; there is no first-party UI for method choice, verification states, or recovery guidance.
- Sign-up today always lands in workspace creation — the direct source of the orphaned-organization problem (users create a solo org, later get invited to the real one, the solo org lingers forever).
- Spec impacts: `specs/auth/auth-signin-flows.feature` ports to router + screens (with D03); `signup-does-not-strand-an-account.feature` anchors survive; new `.feature` files for the full screen set.

# Technical Plan

1. Screen components over D03's routing contract (the router returns a decision + reason; the UI renders it — no routing logic in components).
2. Page-level timing normalization for the enumeration guarantee.
3. Sign-up flow with verification-first ordering and the interstitial hook API (D12 plugs matching + content in; until then the hook renders nothing and sign-up proceeds to create-org).
4. Deny/guidance states wired to router reason codes — the same codes the D05 ops surface displays.
5. New Gherkin specs per screen (golden + failure paths), tagged and bound.
6. Flip with D03; legacy screens deleted at bake end.

# Exit gate / rollback

- **Exit:** every unauthenticated journey round-trips in the new UI (sign-in per live method, sign-up per method, reset, verification, deny states); zero Auth0-hosted pages or assets; sign-up completion ≥ baseline on the funnel dashboard.
- **Rollback:** flag off — legacy screens intact until bake end.

# Security Concerns

- Enumeration: uniform page/timing on sign-in (D03's contract); reset/verification responses identical whether the account exists; sign-up enumeration stance per Open Q12.
- Reset and verification links single-use and expiring.
- Guidance copy must never confirm account existence to an unauthenticated caller beyond what the no-oracle stance allows.

# Open Questions

- (Epic 9) password reset availability in cloud/SSO mode.
- (Epic 12) sign-up enumeration vs the no-oracle scoping.
- (Epic 14) what to do about the orphaned organizations that already exist.

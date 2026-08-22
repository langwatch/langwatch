# D11 — Resilient invitations

Epic: `../identity-platform-redesign.md` · Plan: `delivery-plan.md` · Wave 2 · Depends on: D01 (identifiers) only · Invite changes additive

# Overview

The direct fix for the invitation dead-end support load — pulled ahead of the router because it needs only identifiers, not routing. Acceptance works via any verified method, the inviter can resend in one click, and expiry becomes a visible, recoverable state instead of a silent dead end.

# Requirements

- **Identifier-aware acceptance:** an invite targets an email; acceptance succeeds via any VERIFIED identifier matching that email after normalization — password, Google, or the org's SSO. Account exists with a different method → they sign in with what they have and the invite applies. No account → guided signup that attaches whatever method they choose. No more "invited by email, has a Google account, can't get in."
- **One-click resend** by the inviter (and any org admin): new `inviteCode`, fresh 14-day expiry, new email; old code revoked. Lands in the existing members/invitations UI now; the org-admin surface absorbs the panel at D05.
- **Expiry 2 days → 14 days** — resend is painless, so the window can be generous; EXPIRED is a visible, resendable state.
- **Explicit states:** PENDING → ACCEPTED | EXPIRED | REVOKED; resend = EXPIRED → PENDING (new token). Outstanding invites with state and expiry visible in the members UI now, in both identity surfaces when they exist.

# Data structures

`OrganizationInvite` stays a plain Prisma model (no aggregate — invites are org-admin CRUD with an expiry, not a lifecycle worth a fold); the columns that matter:

```text
OrganizationInvite
  id · organizationId · email (normalized at write) · inviteCode UK
  role · teamIds                       what acceptance passes to grants.attach
  status      PENDING | ACCEPTED | EXPIRED | REVOKED
  expiresAt   createdAt + 14 days      resend: new inviteCode, fresh expiresAt, old code → REVOKED
  invitedById · acceptedByUserId? · acceptedViaAccountId?   which VERIFIED identifier matched
```

Acceptance lookup: invite.email → normalize → all VERIFIED identifiers matching that value across providers → the holder signs in with any of them → `grants.attach` (ledger event `grant_attached` with `source: "invite"`) → status ACCEPTED. The authorization fact lives in the grants ledger; the invite row records only its own outcome.

# Out of Scope

- Join requests (D12 — but note the interplay rules there: answering a request with an invite, and invite acceptance auto-withdrawing a pending request). The acceptance *screen* set (D13's invitation-acceptance screen; this deliverable ships the logic inside today's members UI). Team-assignment UX changes.

# Research

- Today: `OrganizationInvite` (inviteCode, status, 2-day expiry); acceptance assumes the inviter's chosen method; expiry is silent; resend is an ops action. Support threads: Google-linked invitee failing SSO sign-in; invite expiring mid-debug of an `unable_to_link_account` loop.
- Corpus-audit spec impacts: `specs/members/update-pending-invitation.feature` — 48h → 14 days (:94-99); state model PENDING/WAITING_APPROVAL → new states (:121-126, :190-196); add resend scenarios (none exist today). `specs/licensing/enforcement-members.feature:110-123` — expired-invite counting aligns to the new states.

# Technical Plan

1. Acceptance lookup rewrite: invite email → VERIFIED identifiers (normalized) across all methods → sign-in-with-what-you-have → apply invite.
2. `resendInvite` tRPC mutation (permission-checked; inviter + org admins): new code, fresh expiry, new email, old code revoked.
3. Expiry constant + explicit states on `OrganizationInvite`; members-UI affordances (resend, state + expiry display).
4. Spec amendments (`update-pending-invitation`, `enforcement-members`).
5. **Support-pain replay tests:** the Google-linked invitee case and the invite-expired-mid-debug case encoded as tests — green is part of the exit gate.

# Exit gate / rollback

- **Exit:** round-trips — invite → wrong-method account → accepted; expiry → resend → accepted; support-pain replay tests green.
- **Rollback:** additive changes (new states/columns); old acceptance flow flag-restorable during bake.

# Security Concerns

- Acceptance must not weaken targeting: the accepting identifier must be VERIFIED and match the invite email after normalization.
- Resend invalidates the old code — a leaked stale invite link dies on resend.

# Open Questions

- None. Member-initiated `WAITING_APPROVAL` invites are retired (epic Q13): the state model above is complete, and D12's join requests carry the member-wants-a-colleague-in motivation from the joiner's side. The `update-pending-invitation.feature` amendment drops the WAITING_APPROVAL scenarios (`:94-99`, duplicate detection `:121-126`).

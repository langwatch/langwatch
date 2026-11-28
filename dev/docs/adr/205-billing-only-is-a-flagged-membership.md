# ADR-205: Billing only is a flagged Lite membership, not a new organization role

**Date:** 2026-11-24

**Status:** Proposed

> One line: an admin may invite the person who pays as Billing only. The invite and the
> membership it becomes keep role `EXTERNAL` and carry `billingOnly = true`; such a member holds
> the Billing grant at the organization, no team, and is counted in no seat pool.

## Context

- An organization on Free has two member seats and no Lite seat. Once both members are in, the
  person with the card cannot join to pay: every invite is refused at a seat cap
  (`specs/licensing/billing-only-invite.feature`).
- The Billing role already exists. It is a user grant at the organization scope, takes no seat
  and carries only `organization:view`, `subscription:upgrade`, `subscription:manage`,
  `seatRequests:view`, `seatRequests:manage` and `members:view`
  (`specs/licensing/billing-role.feature`). A group or API key holding it gets nothing.
- Seat counting is pure over a holder's role and permissions
  (`modules/entitlement/contract/src/member-classification.ts`). Every counter (organization,
  licensing, SCIM, the memory twins) classifies through it.
- An `EXTERNAL` member reaches projects only through team bindings. With no team binding it
  reaches no project at all.
- The previous release must keep serving on the new schema. Prisma refuses to read a row whose
  enum value its client does not know.

Two models were on the table: a new `OrganizationUserRole` value (`BILLING`), or the existing
`EXTERNAL` role with a flag.

## Decision

We will:

1. Add `billingOnly Boolean @default(false)` to `OrganizationInvite` and `OrganizationUser`.
   A Billing-only invite is stored as role `EXTERNAL`, no team, `billingOnly = true`.
2. Classify an `EXTERNAL` holder with `billingOnly` as `BillingOnly`, a member type no pool
   counts or caps. The invite cap check skips it on every plan, Free included.
3. On acceptance, copy the flag to the membership and grant Billing through `AuthzApi.setBillingRole`
   (source `invite`), idempotent on the invite id. A spent invitation never writes again, since
   an admin may have changed its grants since: if the Billing grant fails after the membership
   commits, an admin turns Billing on in the member's drawer.
4. Refuse a team for a Billing-only invite. Any role change clears the flag, so the new role is
   metered as usual.
5. Refuse every new binding for a Billing-only member in the authz grant writer, system writes
   included (`billing_only_no_team_access`), and create no personal workspace or project for them.
   To give one access, an admin first moves them to a seat role.
6. Offer Billing only on the invite procedure, as `billingOnly: true` on one invite. The invite always names a person by address; there is no group or key form.

## Rationale / Trade-offs

A new role would make every counter skip the person by construction, but it widens three wire
enums, the authorization decision schema and about fifty `EXTERNAL`/`DEVELOPER` branches, and a
rollback would crash the previous release on the first `BILLING` row it reads. The flag keeps the
enum, so the previous release reads a Billing-only member as a Lite member with no team: it may
count one Lite seat too many during a rollback, and it grants nothing extra, because the member
has no team binding and Billing confers only its own bag.

During a rolling deploy a pod on the previous release may accept a Billing-only invite. It does not
know the flag, so it creates a plain Lite membership with no team and no Billing grant: the person
holds a Lite seat and cannot pay. An admin fixes it by turning Billing on in the member's drawer
and, if wanted, inviting them again as Billing only after removing them.

The cost of the flag is that every counter must pass it to the classifier. A counter that forgets
it counts the person as Lite, which refuses a seat rather than granting access. The counters are
covered by the scenario "Accepting a Billing-only invite takes no seat".

Billing is the whole of a Billing-only membership, so it cannot be turned off on its own: the
Billing role service refuses with `billing_only_keeps_billing`. Every organization role keeps the
organization floor, which already includes `subscription:upgrade`, so a Billing-only member
without Billing would still open the plan page and could pay again, which gives Billing back.
The cost is one more step for an admin who wants to keep the person but stop them paying: move
them to a seat first (which is metered), then turn Billing off. To stop them entirely, remove them.
The drawer locks the switch only while the grant is held, so a Billing-only member whose grant
was never written can still be repaired by turning Billing on.

The home page sends a Billing-only member to the plan page, reading the flag through the
organization module's member read. It answers as an override, the same as a home the reader
pinned, so neither a pin set in another organization nor a product the browser remembers takes
them elsewhere. The cost is one more read per home resolution. Switching organization in the
header still decides in the browser and can land a Billing-only member on the coding-agents page
once; opening the home page takes them to the plan page.

## Consequences

- The member list and plan page can show Billing-only members apart from Lite ones.
- An admin who later gives the member a seat role pays for that seat through the normal checks.
- A Billing-only member can start and complete a checkout; completion keeps their Billing grant.

## References

- Issue: langwatch/langwatch#9839
- Related ADRs: ADR-171 (Developer seat), ADR-092 (authorization engine)
- Specs: `specs/licensing/billing-only-invite.feature`, `specs/licensing/billing-role.feature`

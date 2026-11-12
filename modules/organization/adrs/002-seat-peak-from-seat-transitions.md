# ADR-002: The monthly seat peak is folded from seat transitions

**Date:** 2026-11-02

**Status:** Proposed

**Behavioural contract:** [Seat peak](../specs/seat-peak.feature)

## Context

A licence caps the full and Lite Member seats an organization may hold at once. The cap is checked
when a seat is taken, and a seat frees the moment its holder leaves, so an admin can pass one seat
round many people: remove one, add the next. Nothing records that more people held seats over a
month than the licence sold, so a renewal has no number to bill against.

A seat is taken or given back on many paths: a joiner's or single sign-on admission, an email-domain
join, an invitation (which holds its seat while pending), its acceptance, a payment-pending invitation
approved, a role change, a custom role granted to a Lite Member, a disable, a re-enable, a removal, a
directory (SCIM) create, a person's whole account deactivated and an organization's creation. They do not share one write path, and several
record no event at all. The events that do exist (`member_removed`, `member_disabled`,
`member_enabled`) do not say which kind of seat moved.

## Decision

We will record the highest number of full seats, and of Lite Member seats, an organization held at
once in each calendar month, and show it to our own team on the ops console. A pending invitation
counts, because the cap counts it. So does a seat held for 30 days after somebody leaves
(seat-rotation.feature): the cap and the bill count it (accepted by the user, 2026-11-12).

1. **Every seat change is an event that names the seat on both sides.** Each path above records
   `lw.organization.seat_changed` with the holder (a member, a pending invitation or a seat hold), the seat it
   held before and the seat it holds after (`full`, `lite`, `developer` or `none`) and when. A change
   that moves no seat (an admin made from a member) records nothing. Organization classifies the
   seat with the same rule the cap counts by (`classifyMemberType`), so the peak and the cap cannot
   disagree about what a seat is. The change is committed with the write through the outbox the
   audit intents use, never sent after it: a lost change would skew every later count.
   A directory (SCIM) create is the one path organization does not write: SCIM records its
   `lw.scim.member_created` fact with the membership write, and organization subscribes to it,
   reads the member's seat by its own rule and records the seat change (§6). A change is stamped
   in milliseconds, strictly later than the last one the process stamped, so two changes to one
   holder in one write keep their order.
2. **A fold over rows applies them.** `organization_seat_peak`'s fold subscriber runs in the
   worker, per organization, in the order the changes arrive (§7). It keeps the running count of
   each kind of seat and, per calendar month (UTC), the highest count and when it was first
   reached. It adds the seat a change moves to and takes away the seat it moves from; it never
   reads the memberships table. The count is stored as rows, never as one document: one counts row
   per organization, one row per holder and one per touched month. A change loads only its holder,
   the invitations due to expire by then and the months, and writes back only the rows it moved,
   under a per-organization lock, so its cost does not grow with the organization.
3. **An invitation's expiry is folded by event time.** An invitation stops holding its seat when it
   expires, and no event says so. A seat hold is a holder of its own, keyed by its person, holding
   a full seat until its end, and expires the same way. It counts by the cap's rule
   (`countedSeatHolds`): not while its person holds a full seat again, as a member or through a
   live full invitation to their address. A write that moves a hold, or an invitation naming a held
   address, records the hold's change with the member's or the invitation's, a seat given back
   before one taken, so a hold replacing a seat never raises the peak. A hold giving its seat to
   an invitation records which one (`suppressedByInviteId`); when the fold expires that invitation
   it hands the seat back to the hold, inferred like the expiry, and takes it again if a late real
   change revives the invitation. The fold keeps each pending invitation's expiry and, before applying
   a change, gives back the seats of invitations that expired before the change happened. It uses the
   change's own time, never the clock, so a replay gives the same answer.
4. **A month with no change carries the count.** The peak of a month nobody joined or left is the
   count the month began with.
5. **The fold opens from a snapshot.** Seat changes are recorded from this decision on, so there is
   no history to replay before it. A one-off system migration records `seat_snapshot_taken` per
   organization with every holder's seat as it stands; a second snapshot of an opened organization
   moves nothing. It waits until no pod of the previous
   release serves, since those move seats without recording the change. Until an organization has one, its changes are
   not folded and the ops console says counting has not started. A new organization opens at zero.
6. **A custom role flips a seat across modules.** Whether a Lite Member holds a full seat depends on
   their custom role, which authz owns. Organization subscribes to authz's grant events, classifies
   the member again and records a seat change when the seat moved. Every such subscriber (authz,
   user, SCIM) reads the live seat and records it as a change dated at the source event, keyed by
   that event and the holder; it never trusts the fold's state, which may lag. For a named person
   the change is always sent, so a change of theirs dated earlier and still on its way is
   outranked. An event naming only a role or a grant re-reads every member and pending invitation
   and sends a change for each found in a metered seat the fold has not recorded; a seat given
   back is left to its writer's change, so a correction never outranks a late admission.
7. **Changes are folded in the order they arrive** (accepted by the user, 2026-11-02). The outbox
   does not deliver in time order: a retried delivery can be overtaken by the next one, and two
   transactions on one organization can commit out of the order of their stamps. The fold applies
   each change on top of the stored state as it comes and does not hold changes back to replay them
   in time order. Each change still lands in the month of its own time and expires invitations by
   its own time. Each holder is last-write-wins by the change's own time: the fold keeps the time of
   the last change applied to a holder (a snapshot counts as one), drops a change dated at or
   before it (ordered by time, then change id, so only the same change ties), and otherwise moves
   the count from the seat it holds to the change's `to`. A change dated in an earlier month than
   one already folded moves that month and every later one: their closing counts exactly, their
   peaks only upward. An
   invitation's expiry is inferred, not recorded, so it never outranks a real change: a late
   extension restores the seat with its new expiry, which is expired again by event time if it
   too is already past. So the running count is exact in any order, and only a momentary peak can be one
   seat out when two changes cross. A holder who leaves keeps their row with no seat, so a late
   change cannot bring them back, and a redelivered change ties its holder's last change and moves
   nothing.

## Rationale / Trade-offs

A counter bumped on each write path was rejected: the next path somebody adds forgets it, and a
counting rule that changes cannot be applied to the past. Recounting the memberships table on each
event was rejected too: it cannot be replayed, and an add followed quickly by a removal can be
counted after the removal and miss the high point. The fold costs an event on every path, which is
also the audit trail the members table lacks: who held which seat, from when to when.

The snapshot leaves a small window at deploy: a change written after the snapshot read the table but
ordered before its event is counted twice or not at all. That is one seat, once, and only at deploy.

## Consequences

- Every path that takes or gives back a seat records `seat_changed`; a new path that does not is a
  defect the spec's scenarios catch.
- A directory offboarding that deletes an invitation which took another account's held seat
  leaves that hold uncounted until the next organization-wide correction: one seat low, rarely.
- Peaks are kept for full and Lite Member seats; developer seats are unmetered (ADR-171) and only
  pass through the fold.
- The ops console shows the month's peak beside the licence's cap. The customer does not see it.
- Changing the seat rule means clearing an organization's rows and folding its events again in
  order, which the fold allows; the subscriber is not replayed by the framework.
- A stored seat that is not a seat kind fails loudly rather than reading as none, which would
  silently skew every count.

## References

- ADR-171 (developer seats are unmetered)
- `specs/licensing/seat-limit-at-provisioning.feature` (how a seat is admitted past the cap)

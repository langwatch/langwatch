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
counts, because the cap counts it.

1. **Every seat change is an event that names the seat on both sides.** Each path above records
   `lw.organization.seat_changed` with the holder (a member or a pending invitation), the seat it
   held before and the seat it holds after (`full`, `lite`, `developer` or `none`) and when. A change
   that moves no seat (an admin made from a member) records nothing. Organization classifies the
   seat with the same rule the cap counts by (`classifyMemberType`), so the peak and the cap cannot
   disagree about what a seat is. The change is committed with the write through the outbox the
   audit intents use, never sent after it: a lost change would skew every later count.
   A directory (SCIM) create is the one path organization does not write: SCIM records its
   `lw.scim.member_created` fact with the membership write, and organization subscribes to it and
   records the seat change.
2. **A projection folds them.** `organization_seat_peak` runs in the worker, per organization, in
   the order the changes arrive (§7). It keeps the running count of each kind of seat and, per
   calendar month (UTC), the highest count and when it was first reached. It adds the seat a change
   moves to and takes away the seat it moves from; it never reads the memberships table.
3. **An invitation's expiry is folded by event time.** An invitation stops holding its seat when it
   expires, and no event says so. The fold keeps each pending invitation's expiry and, before applying
   a change, gives back the seats of invitations that expired before the change happened. It uses the
   change's own time, never the clock, so a replay gives the same answer.
4. **A month with no change carries the count.** The peak of a month nobody joined or left is the
   count the month began with.
5. **The fold opens from a snapshot.** Seat changes are recorded from this decision on, so there is
   no history to replay before it. A one-off system migration records `seat_snapshot_taken` per
   organization with every holder's seat as it stands. Until an organization has one, its changes are
   not folded and the ops console says counting has not started. A new organization opens at zero.
6. **A custom role flips a seat across modules.** Whether a Lite Member holds a full seat depends on
   their custom role, which authz owns. Organization subscribes to authz's grant events, classifies
   the member again and records a seat change when the seat moved.
7. **Changes are folded in the order they arrive** (accepted by the user, 2026-11-02). The outbox
   does not deliver in time order: a retried delivery can be overtaken by the next one, and two
   transactions on one organization can commit out of the order of their stamps. The fold applies
   each change on top of the stored state as it comes and does not hold changes back to replay them
   in time order. Each change still lands in the month of its own time and expires invitations by
   its own time. Each holder is last-write-wins by the change's own time: the fold keeps the time of
   the last change applied to a holder (a snapshot or an invitation's expiry counts as one), drops
   a change dated at or before it, and otherwise moves the count from the seat it holds to the
   change's `to`. So the running count is exact in any order, and only a momentary peak can be one
   seat out when two changes cross. A holder who leaves is kept with no seat, so a late change
   cannot bring them back. One exception: an invitation's extension that arrives after a change
   dated past its old expiry is dropped, so its seat is missing until its next change.

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
- Peaks are kept for full and Lite Member seats; developer seats are unmetered (ADR-171) and only
  pass through the fold.
- The ops console shows the month's peak beside the licence's cap. The customer does not see it.
- Changing the seat rule means rebuilding the projection from the events, which the fold allows.

## References

- ADR-171 (developer seats are unmetered)
- `specs/licensing/seat-limit-at-provisioning.feature` (how a seat is admitted past the cap)

# ADR-179: Cross-module facts are events; the receiver keeps the applied event id

**Date:** 2026-10-11

**Status:** Accepted

## Context

A module often needs to know that something happened in another module: a licence was stored, a
project was created, a sign-in provider mounted. Two shapes kept appearing for this. One was a new
`*Api` call from the owner to the receiver ("tell licensing the provider mounted"), which adds a
construction edge in the wrong direction and often closes a peer cycle. The other was a per-event
delivery record (an outbox row or intent per fact per receiver), which is durable but grows a table
for every new fact and every new receiver.

The eventing framework already carries most of the durability. An event is appended to the event
log before anything reacts to it (`packages/eventing/src/services/eventSourcingService.ts:365`),
then staged onto each lane (`:374-375`); a lane that cannot be staged is written to the hand-off
outbox and re-driven from the log (`:377`, `:579`). Every append runs inside a command job whose
queue id is stable across crash redelivery (`packages/group-queue/src/contracts.ts:51`), so a crash
between the append and the staging replays the job, whose events collapse onto the first append by
idempotency key (`packages/eventing/src/services/commands/commandDispatcher.ts:48-65`) and are
staged again. A subscriber's own job is acknowledged only once its handler returns. Delivery is
therefore at least once and ordered per aggregate; it is never a replay of history, and a redelivered
fact may arrive under a new event id with the same idempotency key
(`packages/eventing/src/subscribers/eventSubscriber.types.ts:100-104`).

What was missing was a rule for the receiving side: how it stays correct under redelivery and
reordering, and how a reader knows whether the row it holds is current.

## Decision

1. **A cross-module "something happened" is always an event.** The owner records a fact event on
   its own pipeline; the receiver subscribes with `.withPeerSubscriber` on its own pipeline. No new
   `*Api` operation is added to push a fact to another module, and the owner never learns who
   listens (record §9).
2. **A subscriber is either best-effort or durable.**
   - _Best-effort_ stores nothing: SSE fan-out, read hints, live views. A missed event costs a stale
     screen until the next one.
   - _Durable_ changes a row the receiver owns. Its durability comes from the receiver, not from a
     new delivery table.
3. **A durable receiver stores the id of the last event it applied on the row it changes**
   (`lastAppliedEventId`). Event ids are k-sortable KSUIDs, so the handler skips an event whose id is
   the stored one has already passed (`freshnessOf` from `@langwatch/eventing`, which decodes the
   seconds; never a plain string compare) and applies any other. Redelivery is then idempotent and an older event that
   arrives late cannot overwrite a newer state. A receiver that accumulates (counts, sums) rather
   than replaces dedupes by `idempotencyKey ?? eventId`, as today.
4. **That id is the row's version.** A read answering from the row carries it as its cursor, so
   read freshness (`freshnessOf`, read hints) and the client's cache version (its ETag) use the same
   id. The server still answers in full; this adds no `304` or `unchanged` answer (record §10).
5. **Existing per-event durable records stay.** Outboxes, intents and delivery rows that exist today
   are not migrated. New code adds none for a cross-module fact.

## Rationale / Trade-offs

Putting the version on the receiver's row costs one column per receiving table and buys three things
at once: idempotency, ordering and a freshness cursor. A per-event delivery table buys only the first,
and has to be cleaned up. A new `*Api` call is synchronous and simple, but it reverses the dependency
and makes the owner wait on a module it should not know.

The guard compares ids, and KSUIDs order only to the second and then by writer. Two events for one
row inside the same second from different writers may be applied in either order; the per-aggregate
lane makes that rare, and lifecycle-triggered reconciliation covers it, as for projection cursors.

## Consequences

- New cross-module facts land as an event plus a peer subscriber, with no new `*Api` operation and
  no reverse edge.
- Every durable receiver row gains `lastAppliedEventId`; a later sweep adds it to existing peer
  subscribers that write their own rows, one module at a time, without changing delivery.
- Reads over such rows can declare their cursor, so a tab knows it is fresh without polling.
- Nothing replays a subscriber from the start of the log. A receiver added later starts from the
  next event; one that needs history is filled by a background step (`migration-data-step`).

## Amendment 2026-10-21: one row folded from many aggregates

A receiver row folded from several aggregates (the `NurturingOrganization` coding fields, fed by many
projects) guards each field monotonically (null-only, not-has, later-day) instead of one
`lastAppliedEventId`. One id per row would drop valid late facts from the other projects.

## References

- Record: `dev/docs/ARCHITECTURE.md` §9 (peer subscribers, durable receivers), §10 (cursor reads).
- Related ADRs: [ADR-167](167-outbound-delivery.md) (outbound delivery keeps its outbox).
- Ruling: Alex, 2026-10-11.

# ADR-127: An identifier is an aggregate

**Date:** 2026-08-26

**Status:** Proposed

**Amends:** [ADR-101](101-identity-pipeline-and-identifiers.md) §1's aggregate
choice (`aggregateId = userId`). Its TENANCY choice (`tenantId = userId`) is
untouched, and so is everything else in it.

**Builds on:** [ADR-110](110-grant-aggregates-are-grants.md) — a grant is an
aggregate, the organization is the tenant of every event and the aggregate of
nothing. This is the same move, one domain over, and it borrows ADR-110's
answer to the problem it creates: an invariant that used to be swept by a
shared fold becomes a filter the command reads before it states its facts.

**Related:** [ADR-116](116-account-linkage-is-event-truth.md) (the address lock,
which already externalised the uniqueness invariant),
[ADR-119](119-an-account-is-never-left-with-one-way-in.md) (the strands guard),
ADR-029 §4 (purge tractability — why the tenant is the person).

## Context

The identity pipeline gives each PERSON one aggregate. `aggregateId = userId`,
`tenantId = userId`, and a single fold state carries every identifier that
person holds as a map keyed by identifier id.

```
  today                              tenant = user_sam
  ┌──────────────────────────────────────────────────┐
  │ aggregate user_identity : user_sam               │
  │   heads.identifiers = {                          │
  │     idf_google : VERIFIED,                       │
  │     idf_email  : PRIMARY,                        │
  │     idf_passkey: VERIFIED }                      │
  │   + two-step verification (D06)                  │
  └──────────────────────────────────────────────────┘
        one queue lane, one cursor row, one fold state
```

Three things follow from that, and only the first is obviously wanted.

**One lane per person.** The queue's group key is
`${tenantId}/${jobPath}/${aggregateType}:${aggregateId}`, so every ceremony a
person can run is serialised against every other. Attaching a passkey waits
behind verifying an email that has nothing to do with it.

**A fold whose cost is the person, not the fact.** `load()` reads the person's
whole `Identifier` set and `store()` re-upserts every row, per event. This is
ADR-110's measured pathology in miniature — and only in miniature, because a
person holds a handful of identifiers where an organization held every grant it
had ever issued. There is no incident here. This is a shape decision, taken
before the shape can produce one, not a firefight.

**Rehydration with no time bound.** `user_identity` is absent from
`TIME_LOCAL_AGGREGATE_TYPES` (`stores/rehydrationWindow.ts`), so anything that
rehydrates the aggregate reads the person's entire history.

The pipeline's own docblock argues the shared aggregate is a CORRECTNESS
property rather than a tidiness one: two-step verification rides the same
aggregate, so a person's identifier commands and their factor commands land in
one lane and cannot interleave. That mechanism is real. What it currently
guards is not: `mfa-guards.ts` never reads an identifier, `guards.ts`'s detach
never reads a factor, and ADR-119's "one way in" counts verified identifiers
and passkeys — never a second factor. The lane serialises two families that
share a person and, today, no invariant.

## Decision

**An identifier is its own aggregate. The person is the tenant of every
identity fact, and the aggregate of what is genuinely about the person.**

```
                    tenantId = user_sam   (every stream below)
                    aggregateType = user_identity   (every stream below)

  aggregateId = idf_google     one identifier's lifecycle
  aggregateId = idf_email      one identifier's lifecycle
  aggregateId = idf_passkey    one identifier's lifecycle
  aggregateId = user_sam       what is about the PERSON:
                                 two-step verification (D06),
                                 a link proposal (no identifier arrived),
                                 the erasure record
```

**The aggregate TYPE does not change, and that is deliberate.** The type is the
event log's partition key and the store rejects, at append, any event whose type
differs from the one its pipeline declares (#7406); renaming it would repartition
a log that already carries live events. `authz_grant` already carries both grants
and roles for exactly this reason (ADR-110). What names the entity is the
aggregate ID.

**The tenant does not change either.** `tenantId = userId` stays, which keeps
erasure a single tenant scan across both the old streams and the new ones
(ADR-029 §4), keeps `userTenantedCommandSchema`'s wire refusal
(`tenantId === userId`) true as written, and keeps the D01 backfill's tenant
axis, its `SystemMigrationTenantState` rows and the write gate keyed by exactly
what they are keyed by now. It also leaves the ClickHouse tenant question
exactly where it is: `getClickHouseClientForTenant` still receives a user id it
resolves to neither a project nor an organization. **This ADR makes that neither
better nor worse, and does not depend on the fix for it.** Nothing here can be
read as having addressed it.

### The two sweeps become routing

A shared stream was carrying two invariants in the FOLD, over state no
per-identifier fold can see:

| invariant | how the shared fold held it | where it goes |
|---|---|---|
| exactly one PRIMARY per person | a promotion demoted **every** other standing PRIMARY, not only the one the fact names | `primaryChangeFacts` reads the person's heads and states one fact per stream that must move |
| erasure reaches every identifier | the fold wiped **every** head, not only the ids the writer listed | `userErasureFacts` reads the person's heads; that read is the sweep's bound |

Both moves are ADR-110's principal-filter rule in identity's terms:
*enforcement takes a filter over the whole subject rather than a list the caller
enumerated.* The reads already exist — `markPrimary` and `eraseUser` both call
`findHeads({ userId })` before they state anything.

The FOLD RULES do not move. `reduceIdentifier` folds one head; `reduceIdentity`
is now that same function plus a DELIVERY decision (hand every fact to every
head), and a per-identifier fold is the same function plus a different delivery
(hand each stream what `identityStreamsFor` routes to it). On the facts a
command states, the two agree, and a test pins that.

**A third invariant needed no move.** Address uniqueness was already outside the
aggregate: `IdentifierReservation` is a row-truth lock claimed before any fact is
stated (ADR-116 §6, migration `20260824120003`). A per-identifier aggregate
changes nothing about it. The provider-subject collision is likewise arbitrated
by a partial unique index on the projection, not by fold state.

**A fourth is a genuine loss, named.** Two-step verification stays on the
person's stream, so factor commands and identifier commands stop serialising.
Nothing today reads across them (above), so nothing breaks on the day this
lands. What this ADR forbids is acquiring such a coupling later and relying on
the lane for it: a cross-family invariant is enforced by a read and a refusal in
a guard, the way uniqueness is, never by two things happening to share a queue.

### The existing log is not rewritten

The log is live: events have been appended under `aggregateId = userId`, and the
dedupe key is `(TenantId, AggregateType, AggregateId, IdempotencyKey)`, so a
fact restated under a new aggregate id does not collapse onto its old row — it
is a second row. Restating history under the new ids would therefore double it,
and would need every finalized user moved off a terminal migration status to do
it at all.

So we do not restate, and we do not mutate. **The fold's KEY is version-gated
instead.**

```
  event VERSION >= the per-identifier envelope   key = event.aggregateId
  older (the per-user envelope)                  key = the identifier the
                                                       payload names
```

The framework supports this directly: a fold projection may declare
`key(event)`, and that one function decides both the store key and the queue
lane (`projectionRouter.ts`), in live dispatch and in replay alike
(`replayExecutor.ts`: `this.projection.key?.(event) ?? event.aggregateId`). So a
legacy `identifier_attached` stamped under `user_sam` folds into
`idf_google`'s head, next to the new events stamped under `idf_google` — one
head, whole history, no log rewrite and no operator ceremony.

Two legacy shapes cannot be routed by payload, and both are stated here rather
than discovered later:

- **A legacy `user_erased` names N identifiers in one event.** One event has one
  key, so it can only reach one head. It keys to the person's stream and wipes
  nothing. This is a real gap while it lasts, and it is *not* covered by "the log
  mutation already removed the values": ADR-101 §5's event-log mutation **does
  not exist in code today** — `eraseUser` states the fact and the erasure
  service that was to sequence the mutation, the protocol-row deletions and the
  `userHashKey` shred around it was never written. The wipe that does happen is
  the fold's, on the projection. So the per-identifier cutover must either (a)
  land after the erasure service, or (b) carry a one-off sweep that re-states an
  erasure per identifier for every already-erased user. (b) is cheap and is the
  recommended slice.
- **A legacy `primary_changed` that names no previous** cannot demote anybody on
  replay, because the demotion was the fold's sweep and the fact does not name
  its target. A from-scratch rebuild of such a history can therefore leave two
  heads PRIMARY where the live projection has one. Reachable only from a
  partial-window replay in the first place; the remedy, if it ever shows, is a
  parity check on the projection rather than a change to the log.

### What the write gate and the D01 backfill do

Nothing. Both are rooted in the PERSON, and the person is still the tenant:

- `write-gate.ts` latches on the user's `SystemMigrationTenantState` row for
  `identity-d01-identifier-backfill`. The question it asks — "is this person's
  whole identifier history in the log?" — is a question about the person, not
  about a stream, and stays exactly as it is. A per-identifier latch would be
  wrong as well as unnecessary: a person is adopted whole, and half a person on
  the identity branch is not a state the ceremonies can be in.
- The backfill already mints a command per identifier
  (`backfill:<accountId>`, `backfill:detach:<identifierId>:<accountId>`), so its
  commands fan out into per-identifier lanes for free the moment
  `getAggregateId` changes, and a person's adoption stops being serial. Its
  parity proof reads the whole person from the projection, which is a Postgres
  read keyed by `userId` and is unaffected.

## Rationale / Trade-offs

**Why not rename the aggregate type to `identifier`?** It reads better and costs
a repartition of a live log plus a second pipeline for the person-level family,
since a pipeline declares exactly one type. The type is infrastructure; the id is
the entity. ADR-110 settled this the same way.

**Why keep the person's stream at all?** Because two facts are about a person and
not an identifier: a link proposal states that NO identifier arrived (ADR-117
§3), and two-step verification belongs to the person by nature. Forcing them onto
some identifier's stream would be a lie about what they say.

**Why version-gate the fold key rather than restate the log?** Restating is what
ADR-110 did, and it worked there because the grants migration was the switch and
nothing was finalized behind it. Here the migration is mid-rollout with finalized
users behind a terminal status, and `finalized` short-circuits the runner. A
version-gated key needs no operator action, no second copy of any fact, and no
window in which a person's history is half in one place and half in another.

**What we give up** is a lane that was serialising two families with no shared
invariant, and the ability to add such an invariant later without doing the work
properly. We take that knowingly.

## Consequences

- A person's ceremonies stop serialising against each other. Two identifiers can
  attach concurrently; the backfill adopts a person's accounts in parallel.
- A fold apply becomes one identifier: one row loaded, one row written. The cost
  of an event stops depending on how many identifiers the person holds.
- **The projection cursor has to become per-stream.** `IdentityProjectionCursor`
  is `userId @id` today and is the fold's commit marker; under per-identifier
  keys it needs the identifier as its key, with the person's own stream keeping a
  row of its own. That is a Prisma migration and it is the largest single piece
  of the wiring.
- The ops event explorer's "look up one aggregate" stops returning a person's
  whole identity history in one query. It is still one query — by TENANT, which
  is the person — and the unimplemented
  `specs/identity/platform-ops-identity-lookup.feature` should be written against
  the tenant rather than the aggregate.
- Read-your-writes (`ledger.awaitFold`) currently watches one cursor for the
  person. It becomes a watch on the streams the command's facts were routed to,
  and a command whose facts touch two streams waits for both.
- Erasure over the log stays a single tenant scan, because the tenant did not
  move. When the erasure service is finally written, it must scan by TENANT and
  not by aggregate, or it will wipe one identifier's history and leave the rest.
- The ClickHouse user-tenant resolution problem is untouched, in both directions.

## Delivery

This ADR is landing across slices. The first has shipped with it.

1. **The domain split** *(this change)* — `identityStreamsFor`,
   `reduceIdentifier`, `primaryChangeFacts`, `userErasureFacts`;
   `reduceIdentity` re-expressed as the same rules with per-person delivery, so
   the live fold is byte-for-byte what it was; the two sweeps moved into the
   guards. Nothing is rewired, so nothing changes in production.
2. **The envelope and the lanes** — `identityEventsFor` stamps the routed
   aggregate id per fact, the six identity commands' `getAggregateId` answers the
   identifier (attach derives it from the payload, exactly as the guard does),
   MFA's stays the person.
3. **The fold and the cursor** — `IdentityStateFoldProjection` folds one head,
   declares the version-gated `key(event)`, and `PrismaIdentityProjectionRepository`
   loads and stores one identifier; the `IdentityProjectionCursor` migration; the
   address-lock release and the `Account` projection re-derived per identifier
   rather than per person.
4. **The ledger's wait** — `awaitFold` over the routed streams.
5. **The erasure sweep** — a one-off restatement of a per-identifier erasure for
   every already-erased person, and the fold-key gate's legacy branch documented
   against it.
6. **Replay and ops** — replay parity for a mixed-version history; the ops
   lookup re-pointed at the tenant.

## References

- Specs: [`specs/identity/identifier-aggregate.feature`](../../../specs/identity/identifier-aggregate.feature),
  `specs/identity/identifier-model.feature` (D01, unchanged by this ADR)
- [ADR-101](101-identity-pipeline-and-identifiers.md) §1, §3, §5 · [ADR-110](110-grant-aggregates-are-grants.md) · [ADR-116](116-account-linkage-is-event-truth.md) §6 · [ADR-119](119-an-account-is-never-left-with-one-way-in.md)
- Framework mechanism: `projections/projectionRouter.ts` (the store key and the
  lane are both `key(event) ?? event.aggregateId`),
  `replay/replayExecutor.ts` (the same rule in replay),
  `stores/eventStoreUtils.ts` (`validateEventAggregateType` — the type is
  checked at append, the id is not)

Numbering: 122–126 are claimed by in-flight identity branches, so this record
takes 127.

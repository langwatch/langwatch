# ADR-127: An identifier is an aggregate

**Date:** 2026-08-26

**Status:** Proposed

**Amends:** [ADR-101](101-identity-pipeline-and-identifiers.md) — §1's aggregate
choice (`aggregateId = userId`) and, with it, §2's per-user queue lane, the
per-user projection cursor and the read-your-writes wait built on it. §1's
TENANCY choice (`tenantId = userId`) stands, restated here deliberately rather
than by omission.

**Builds on:** [ADR-110](110-grant-aggregates-are-grants.md) — a grant is an
aggregate, the organization is the tenant of every event and the aggregate of
nothing. This is the same move, one domain over, and it borrows ADR-110's
answer to the problem it creates: an invariant that used to be swept by a
shared fold becomes a filter the command reads before it states its facts.

**Related:** [ADR-116](116-account-linkage-is-event-truth.md) (the address lock,
which already externalized the uniqueness invariant),
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
person can run is serialized against every other. Attaching a passkey waits
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
guards is not: `mfa-guards.ts` never reads an identifier, and `guards.ts`'s
detach counts VERIFIED and PRIMARY heads and refuses a passkey-only remainder
without reading a factor at all. (ADR-119 states the "one way in" principle and
says the detach guards are D07's; the rule as built lives in
`guards.ts` and `specs/identity/passkeys.feature`.) The lane serializes two
families that share a person and, today, no invariant.

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
differs from the one its pipeline declares (`validateEventAggregateType`, #7406);
renaming it would repartition a log that already carries live events. The
aggregate ID is checked by nothing — no layer compares an event's id to its
command's — so it is free to name the entity while the type keeps naming the
partition.

The authz pipeline is the precedent, and it is worth stating precisely because
it differs from its own ADR: ADR-110's decision box draws `authz_grant` and
`authz_role` as two types, but what shipped declares ONE
(`pipelines/authz-grants/schemas/constants.ts`: "ONE aggregate TYPE for both
families, and it is not cosmetic … a separate `authz_role` type would have to
come with a pipeline of its own"). Grants and roles are told apart by their
aggregate ids under a shared type, which is exactly the shape below.

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

| invariant                        | how the shared fold held it                                                           | where it goes                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| exactly one PRIMARY per person   | a promotion demoted **every** other standing PRIMARY, not only the one the fact names | `primaryChangeFacts` reads the person's heads and states one fact per stream that must move |
| erasure reaches every identifier | the fold wiped **every** head, not only the ids the writer listed                     | `userErasureFacts` reads the person's heads; that read is the sweep's bound                 |

Both moves are ADR-110's principal-filter rule in identity's terms:
_enforcement takes a filter over the whole subject rather than a list the caller
enumerated._ The reads already exist — `markPrimary` and `eraseUser` both call
`findHeads({ userId })` before they state anything.

**A fact that names two streams is appended twice.** An event carries one
aggregate id, so routing a fact to N streams means N events: the same payload, N
aggregate ids, N `<commandId>:<index>` idempotency keys. A promotion that demotes
somebody is two rows in the log where it was one; an erasure for a person holding
three identifiers is four. That is the price of every stream hearing what it
needs, it is bounded by the identifiers a person holds, and the alternative —
picking one of the streams — is the legacy gap below, reproduced on new events.
It also means `awaitFold` waits on every stream a command's facts were routed
to, not one.

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
person's stream, so factor commands and identifier commands stop serializing.
Nothing today reads across them (above), so nothing breaks on the day this
lands. What this ADR forbids is acquiring such a coupling later and relying on
the lane for it: a cross-family invariant is enforced by a read and a refusal in
a guard, the way uniqueness is, never by two things happening to share a queue.

### What one head cannot see

"On the facts a command states" is doing real work in that sentence, and the
exceptions are worth stating rather than discovering. A per-person fold could
read across heads; a per-identifier fold cannot, so two histories fold
differently — and both are reachable only from a partial replay window, because
`primaryChangeFacts` cannot state either shape.

| history                                                                                      | per person                                                          | per identifier                                              |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------- |
| a promotion naming a previous, where the promoted head is absent or ineligible in the window | nothing moves: the demotion was conditional on the promotion taking | the previous is demoted, so the person ends with no PRIMARY |
| a promotion naming NO previous, while another head stands PRIMARY                            | the standing head is demoted — the fold swept for it                | the fact is never routed to that head, so two stand         |

Both are degradations rather than corruptions, and they fall on the safe side of
different lines: no PRIMARY means the legacy email field falls back to the most
recently VERIFIED identifier, which the D01 read fork already specifies; two
PRIMARY is the one that matters, and it is a _legacy_ fact's shape — every fact
stated from here on names each standing holder. The remedy for it, if it ever
shows, is a parity check over the projection ("exactly one PRIMARY per person"),
not a change to the fold: a rule that repaired state the fact did not name is
precisely the sweep a bounded aggregate gives up.

Tests pin both divergences, so the boundary is asserted rather than assumed.

### The lane is not the aggregate

Splitting the aggregate splits the queue lane with it, and two guards are
currently relying on that lane without saying so. `markPrimary` and
`detachIdentifier` both read the WHOLE person and refuse on what they read: one
finds every standing PRIMARY, the other counts the ways in that would remain
(ADR-119's strands guard, `guards.ts`). Today those reads are decisive because
every command a person can run is serialized behind them. Per identifier they
are not: two concurrent promotions each see no standing PRIMARY and both state
`previousIdentifierId: null`, leaving two heads PRIMARY; two concurrent detaches
each see the other still VERIFIED and between them strand the account. That is
the same class ADR-116 §6 already settled once — _a read cannot decide a race_ —
and it is why address uniqueness has a row-truth lock rather than a guard.

So the aggregate moves and **the lane does not follow it blindly**. A command's
aggregate id names only its queue lane; the events it states carry their own
(nothing in the framework ties them together). The rule that falls out:

```
  command            lane           because
  attach_identifier  identifier     its cross-person race is decided by the
  verify_identifier  identifier     address lock, not by a read
  mark_primary       PERSON         its guard reads every head and refuses
  detach_identifier  PERSON         its guard reads every head and refuses
  erase_user         PERSON         it is about the person
  propose_link       PERSON         it is about the person
  (two-step, D06)    PERSON         unchanged
```

The concurrency this ADR is for is the concurrency it actually gains: attaches
and verifies, which are the ceremonies that happen at volume and the ones the
backfill fans out. Promotion and detach are rare, deliberate, one-at-a-time acts,
and keeping them on the person's lane costs nothing anybody will notice. If they
ever need to fan out, the answer is a row-truth claim in the shape of
`IdentifierReservation`, not a wider lane — but that is a decision to take when
there is a reason, not now.

Attach and verify moving off the person's lane still lets them interleave with a
detach on it, and both directions land on the safe side. A verify that completes
after a detach has read the heads makes the detach's refusal more conservative
than it needed to be, not less. A detach that completes after a verify has read
its head leaves that head DETACHED, and `reduceIdentifier` refuses to resurrect a
tombstone — so the projection is right either way, and the person is never left
with fewer ways in than the guard believed.

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
  nothing. This is a real gap while it lasts, and it is _not_ covered by "the log
  mutation already removed the values": ADR-101 §5's event-log mutation **does
  not exist in code today** — `eraseUser` states the fact and the erasure
  service that was to sequence the mutation, the protocol-row deletions and the
  `userHashKey` shred around it was never written. The wipe that does happen is
  the fold's, on the projection. So the per-identifier cutover must either (a)
  land after the erasure service, or (b) carry a one-off sweep that re-states an
  erasure per identifier for every already-erased user. (b) is cheap and is the
  recommended slice.
- **A legacy `primary_changed` cannot deliver its demotion half at all** — and
  this is every legacy promotion, not only the ones naming no previous. One event
  keys to one stream, so a fact naming both a promoted and a previous identifier
  reaches the promoted one and the demotion is unreplayable. A from-scratch
  rebuild of such a history therefore leaves the old holder PRIMARY alongside the
  new one. The remedy is the projection parity check ("exactly one PRIMARY per
  person"), which is worth having anyway; the alternative — re-stating each legacy
  promotion as a pair — is a log rewrite for a state the live projection already
  holds correctly.

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
version-gated key needs no operator action, no restatement of any fact already in
the log, and no window in which a person's history is half in one place and half
in another. (New facts do fan out into one event per stream, above — that is the
routing working, not a copy of history.)

**What we give up** is a lane that was serializing two families with no shared
invariant, and the ability to add such an invariant later without doing the work
properly. We take that knowingly.

## Consequences

- A person's ceremonies stop serializing against each other. Two identifiers can
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
  is the person — and `platform-ops-identity-lookup.feature`'s "the most recent
  identity history is shown newest first" (still `@unimplemented`) is the line
  that has to be a tenant-scoped read rather than an aggregate one.
- Read-your-writes (`ledger.awaitFold`) currently watches one cursor for the
  person. It becomes a watch on the streams the command's facts were routed to,
  and a command whose facts touch two streams waits for both.
- **`User.email` needs an owner.** ADR-101 §3 and ADR-116 §6 have the fold
  polyfill it from the PRIMARY identifier — a person-level column written by what
  is about to become a per-identifier fold, and under per-identifier lanes two
  streams could write it at once. Nothing writes it today, so this is a slice-3
  design item rather than a live defect: the promoted identifier's stream should
  own the write, because it is the only stream that knows it just became PRIMARY.
- Erasure over the log stays a single tenant scan, because the tenant did not
  move. When the erasure service is finally written, it must scan by TENANT and
  not by aggregate, or it will wipe one identifier's history and leave the rest.
- The ClickHouse user-tenant resolution problem is untouched, in both directions.

## Delivery

This ADR is landing across slices. The first has shipped with it.

1. **The domain split** _(this change)_ — `identityStreamsFor`,
   `reduceIdentifier`, `primaryChangeFacts`, `userErasureFacts`;
   `reduceIdentity` re-expressed as the same rules with per-person delivery, so
   the live fold is byte-for-byte what it was; the two sweeps moved into the
   guards. Nothing is rewired, so nothing changes in production.
2. **The envelope and the lanes** — `identityEventsFor` stamps the routed
   aggregate id per fact and emits one event per routed stream; `attachIdentifier`
   and `verifyIdentifier` take a per-identifier lane (attach derives the id from
   the payload, exactly as the guard does); `markPrimary`, `detachIdentifier`,
   `eraseUser`, `proposeLink` and every MFA command keep the person's lane, for
   the reason in "The lane is not the aggregate".
3. **The fold and the cursor** — `IdentityStateFoldProjection` folds one head,
   declares the version-gated `key(event)`, and `PrismaIdentityProjectionRepository`
   loads and stores one identifier; the `IdentityProjectionCursor` migration; the
   address-lock release and the `Account` projection re-derived per identifier
   rather than per person.
4. **The ledger's wait** — `awaitFold` over the routed streams.
5. **The erasure sweep, and the snapshot it depends on** — a one-off
   restatement of a per-identifier erasure for every already-erased person, and
   the fold-key gate's legacy branch documented against it.

   This slice also carries a requirement the per-person fold met for free.
   Today's fold sweeps whatever heads exist **at fold time** and ignores the
   ids the fact names, so an identifier attached between the erase command's
   read and its apply is wiped anyway. Under routing, the list is decided at
   COMMAND time — and erasure keeps the person's lane while ATTACH does not, so
   the two can interleave where today they cannot. An identifier that arrives in
   that window would never be routed the wipe and would keep its value
   permanently. The
   erasure ceremony runs in `user.delete.before` and the write gate closes
   behind it, which makes the window small, and small is not closed. Slice 5
   must either have the per-identifier fold apply an erasure it sees for the
   person's tenant to its head regardless of the stated list, or refuse an
   attach for a person whose erasure has been stated. Naming it here so it is
   designed rather than discovered.

6. **Replay and ops** — replay parity for a mixed-version history; the ops
   lookup re-pointed at the tenant.

## References

- Specs: [`specs/identity/identifier-aggregate.feature`](../../../specs/identity/identifier-aggregate.feature).
  `specs/identity/identifier-model.feature` keeps every scenario through this
  slice, and two of its lines need rewriting later: _the command is staged onto
  sam's queue lane_ at slice 2, and _folding the erasure wipes value and hash
  fields from sam's Identifier rows_ at slice 3.
- [ADR-101](101-identity-pipeline-and-identifiers.md) §1, §3, §5 · [ADR-110](110-grant-aggregates-are-grants.md) · [ADR-116](116-account-linkage-is-event-truth.md) §6 · [ADR-119](119-an-account-is-never-left-with-one-way-in.md)
- Framework mechanism: `projections/projectionRouter.ts` (the store key and the
  lane are both `key(event) ?? event.aggregateId`),
  `replay/replayExecutor.ts` (the same rule in replay),
  `stores/eventStoreUtils.ts` (`validateEventAggregateType` — the type is
  checked at append, the id is not)

Numbering: 122–126 are claimed by in-flight identity branches, so this record
takes 127.

# ADR-114: Grant commands ride one ordered lane, and the statement budget is not first-come

**Date:** 2026-08-23

**Status:** Accepted. **Decision 1 was amended the same day, before it ever ran
in production** — see [Amendment (2026-08-23)](#amendment-2026-08-23--decision-1-traded-away-an-ordering-guarantee).

**Redacted for publication (2026-08-23).** The Context section originally
carried a table of production measurements, a per-job-type latency chart, the
arithmetic derived from them, and the identifier of the organization involved.
This repository is public, so the narrative was rewritten to describe the
failure by its shape instead. Nothing about the decision changed, and the
removed material is deliberately not reproduced or summarised here — if you
need the figures, they are in the incident's own records, not in a public
repository.

**Builds on:** ADR-110 (a grant is its own aggregate), ADR-100 (the
aggregate-scoped lane), ADR-066 pillar 2 (append coalescing).

**Related:** ADR-092 (the authorization engine), ADR-101's lineage in
ADR-110's supersession note.

## Context

ADR-110 gave every grant its own aggregate, which fixed the whole-org fold:
one aggregate's state is now one grant, not every grant the organization has
ever held. That was correct and it stands.

It also, as a side effect, gave every grant its own **queue lane**. A
command's group key is `${aggregateType}:${getAggregateId(payload)}`
(`queueManager.ts`), so `attachGrant` for grant `g` lands in the lane
`authz_grant:g` — a lane of one. Nothing else ever joins it.

That is fine for interactive access changes, which arrive one at a time. It
is the wrong shape for a bulk producer, and a migration restating one
organization's whole fact set is exactly that: each fact appended its own
single-row insert into `event_log`.

What that did, in shape rather than in figures:

- The ClickHouse statement limiter (`server/clickhouse/statementLimit.ts`)
  went to its ceiling and stayed there, with a long wait queue behind it.
- Job duration became dominated by time spent waiting for a statement slot
  rather than by doing any work.
- Throughput therefore collapsed to the rate the limiter could drain,
  fleet-wide.

Two things are worth stating plainly about that.

**Concurrency was never the constraint.** Active group count and worker CPU
did not move throughout. The fleet was full of jobs that were all asleep
waiting for the same semaphore. Raising the dispatch budget — the intuitive
fix, and one we considered — would have admitted more jobs into a fleet with
no free slots and a saturated limiter. It would have made this worse.

**The blast radius was the whole platform, not the migration.** Every job type
that touches ClickHouse slowed by roughly the same factor, customer span
ingestion (`recordSpan`) included, because the limiter is first-come,
first-served: it bounds total concurrency and bounds the wait queue, but it
has no notion of what the statement is *for*. A bulk backfill and a customer's
trace write are peers.

## Amendment (2026-08-23) — decision 1 traded away an ordering guarantee

The decision below originally sharded an organization's grant commands across
a fixed number of lanes so their appends could coalesce. That shipped and was
withdrawn the same day, before the shape ever ran under load. This section
records why, because the reasoning that justified it was wrong in a way worth
keeping.

The original text claimed: *"Different command **types** already sat in
different lanes (the job path carries the command name), so nothing that was
ordered stops being ordered."* The first half is true. The second half does
not follow.

`buildGroupKey` composes `${tenantId}/${jobPath}/${aggregateType}:${key}`, and
for a command `jobPath` is `command/${commandName}`. So one grant's attach and
its revoke have **always** lived in two different lanes:

```text
<org>/command/attachGrant/authz_grant:<grantId>
<org>/command/revokeGrant/authz_grant:<grantId>    <- a different lane
```

Under the pre-existing shape both lanes held about one command and drained
immediately, so the skew between them was negligible and the reordering was
theoretical. Sharding was designed to make lanes **deep** — that was the whole
point. A deep attach lane next to a nearly empty revoke lane makes the skew
proportional to the backlog. The guarantee was formally unchanged and the
*behaviour* was not, and the ADR described only the former.

**The projection cannot recover the order downstream.** The `occurredAt` guard
in `authz-grants-write.prisma.repository.ts` adjudicates between two writes to
a row that exists; it cannot defend a row that does not:

```text
revoke lands first  ->  UPDATE ... WHERE id = g   ->  matches 0 rows, writes NOTHING
attach lands second ->  INSERT ... ON CONFLICT    ->  inserts a LIVE row
                                                      no revocation contradicts it
```

The repository's own docblock names this and assigns the fix elsewhere:
*"There is no honest fix at this layer … The fix belongs to the migration."*
That assignment is only sound while ordinary traffic does not reorder. Making
lanes deep breaks the premise it rests on.

The blast radius was bounded — `enforceGrantRevocation` writes `revokedAt` to
the legacy row synchronously before the event is queued, so the enforcing path
never waited on the queue, and the migration's own check reports a
`grant_revoked` diff and holds the organization. So the exposure was a
projection divergence that is detectable and eventually reconciled, not a
silent grant of access. It was still a hazard the ADR had claimed not to
introduce.

**What replaced it is strictly stronger than what came before.**
`serializeByAggregate: true` forces the key to the aggregate id *and* drops the
command name from `jobPath`, so all three commands about one grant share one
FIFO lane — closing a gap that predates this ADR entirely:

```text
BEFORE (ADR-110 default)     attach -> <org>/command/attachGrant/authz_grant:g
                             revoke -> <org>/command/revokeGrant/authz_grant:g
                                                                       two lanes

SHARDED (withdrawn)          attach -> <org>/command/attachGrant/authz_grant:<shard>
                             revoke -> <org>/command/revokeGrant/authz_grant:<shard>
                                                                       two DEEP lanes

NOW (serializeByAggregate)   attach -> <org>/command/authz_grant:g
                             revoke -> <org>/command/authz_grant:g     ONE lane, FIFO
```

It also changes how a lane is ordered. `serializeByAggregate` scores jobs by
**arrival** (`Date.now()`) rather than by business time (`occurredAtScore`), so
a grant's lane is strict enqueue-order FIFO. For a single aggregate that is the
right meaning of "in order": a retry cannot sort itself ahead of a newer
command by carrying an older timestamp.

**What we gave up.** The statement economy a batch factor would have bought.
That is a real loss and it is affordable for one reason: **#7429 removed the
volume at source.** A pass now states only the facts the projection heads do
not already carry, so the bulk producer that motivated the sharding no longer
exists. Buying throughput we no longer need with an ordering guarantee we do
need is the wrong trade.

Correspondingly, `commandShardKey.ts` moves back to
`pipelines/trace-processing/commands/`, its only home again now that the
grant lane no longer shares it.

## Decision

### 1. Every command about one grant rides one ordered lane

`attachGrant`, `revokeGrant` and `changeGrantRole` declare
`serializeByAggregate: true`. The queue key becomes
`<org>/command/authz_grant:<grantId>` — one FIFO lane per grant, holding every
command type that can change it.

Distinct grants keep distinct lanes, so an organization's grant work is still
as wide as the number of grants in flight; only the commands about *one* grant
serialize, which is exactly the constraint the domain has.

They also keep `coalesceMaxBatch`, which now means something narrower: it folds
**one grant's** queued same-command jobs into a single insert. That is the
`serializeByAggregate` shape `queueManager` explicitly names ("many commands,
one aggregate"), and it is safe because those jobs share an aggregate and drain
in order. It buys no cross-grant economy and is not meant to. Keeping it also
keeps the registration out of the "grouped producer without append coalescing"
gap the queue manager logs.

**The fold is untouched.** ADR-110's aggregate stays the grant: fold state is
still one grant, still `authz_grant:<grantId>`. What changes is only which
queue lane a command *waits in* before it is handled.

Role commands keep the default per-aggregate lane. A role is a rare,
human-sized entity, an organization has a handful, and no bulk producer emits
them in volume.

### 2. The statement budget is shared per producer, not first-come

**Deferred, with its design settled here.** Not implemented in the PR that
carries this ADR.

The first shape considered was a two-class split: statements are
`interactive` by default, a caller may declare itself `background`, and
background work may hold at most a fraction of the budget. Writing it down
killed it. `recordSpan` — the job whose latency is the reason this matters —
is queue work too. Any rule that classes "queue work" as background starves
customer ingestion alongside the migration and contains nothing that actually
happened here.

The axis that separates them is the **producer**, not the caller's
interactivity. The correct shape is the one the dispatch path already has:
a max-min fair share of the statement budget across the pipelines with
demand, so a lone producer may use the whole budget and N producers converge
on a fair share of it. A migration flooding `authz_grant` would then be
bounded by its own share while `trace-processing` keeps drawing on its own.

The seam exists. `groupQueue.ts` already runs every job body inside
`runWithContext`, so a statement can learn which pipeline it is being issued
for without a parameter on every call site.

This is deferred rather than sketched-and-shipped because it is a piece of
work on the scale of the dispatch water-fill itself, and it sits on a hot
path every ClickHouse caller in the app crosses. It removes the *class* of
incident; decision 1 no longer even attempts to.

## Rationale / Trade-offs

**Why not raise the statement budget?** It is per-server on purpose and sized
to what ClickHouse itself will accept; raising it moves the queue from our
process into the database, where it is less visible and less recoverable. The
budget is not the bug. Consuming all of it for restated facts is.

**Why not keep sharding and fix the ordering elsewhere?** The two candidate
homes both fail. The projection cannot: a revoke against an absent row writes
nothing, and nothing in the `revoked` event carries the principal, scope and
resource a tombstone row would need. The migration can be taught not to state
a back-dated `attached` for an already-revoked grant — and should be, since
that hazard predates all of this — but that only covers the migration, and the
skew sharding introduces applies to ordinary interactive traffic too.

**Why is losing the batch factor acceptable?** Because #7429 deleted the
demand rather than absorbing it. The appends were a pass restating facts the
heads already carried; a pass now states only what is missing. Should another
bulk grant producer appear, the answer is decision 2 — bound what one producer
may hold — not a wider lane that reorders a grant's own history.

**Why not both — shard, and serialize a grant across command types?** The
queue offers exactly two shapes and they are mutually exclusive.
`serializeByAggregate` forces the key to the aggregate id and ignores
`getGroupKey`; an explicit `getGroupKey` keeps the command name in the job
path. There is no third option, and inventing one means changing
`buildGroupKey` for every pipeline to buy back an economy we no longer need.

## Consequences

- One grant's commands apply in the order they were issued, across command
  types — a guarantee the pipeline did not have before this ADR, under either
  of its versions.
- A grant's lane is ordered by arrival rather than by business time. For a
  single aggregate this is the stronger reading; nothing depended on the
  previous one.
- Grant append volume returns to one statement per event. Acceptable only
  because #7429 removed the producer that made that expensive; if a new bulk
  grant producer appears, decision 2 is the answer and this ADR is not.
- Until decision 2 lands, one producer can still exhaust the statement
  budget. The containment gap stays open and named.
- `commandShardKey.ts` returns to `pipelines/trace-processing/commands/`.
  Trace-processing's own sharding is unaffected throughout — spans are
  ReplacingMergeTree-deduplicated by business timestamp and carry no
  cross-command ordering requirement, which is exactly why sharding is right
  there and wrong here.

## References

- `platform/app/src/server/event-sourcing/pipelines/authz-grants/pipeline.ts`
- `platform/app/src/server/event-sourcing/services/queues/queueManager.ts`
  (the group key, and `serializeByAggregate`'s effect on `jobPath` and `scoreFn`)
- `platform/app/src/server/app-layer/authz/repositories/authz-grants-write.prisma.repository.ts`
  (the `occurredAt` guard, and the absent-row case it cannot defend)
- `platform/app/src/server/clickhouse/statementLimit.ts`
- `specs/event-sourcing/authz-grant-command-lanes.feature`
- PR #7429 — the heads filter that stopped the restaging at source
- ADR-110 — a grant is its own aggregate

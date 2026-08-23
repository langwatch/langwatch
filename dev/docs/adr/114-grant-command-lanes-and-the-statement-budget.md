# ADR-114: Grant commands share a sharded lane, and the statement budget is not first-come

**Date:** 2026-08-23

**Status:** Proposed

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
is the wrong shape for a bulk producer. On 2026-08-23 the ADR-110 migration
restaged 428,720 share-link facts for organization `HXECRq2mRfSQpxTiSCcsS`
and each fact appended its own single-row insert into `event_log`.

Measured in production, 14:29 → 16:03 UTC+2:

| | during | after staging stopped |
|---|---|---|
| ClickHouse statements in flight | **200** (the limiter's whole budget) | 39 → 11 |
| ClickHouse statements queued | ~1,090 | 0 |
| mean wait for a statement slot | **5.7 s** | 0.000018 s |
| mean job duration | 6,300 ms | 571 ms |
| jobs completed | ~200/s | ~2,092/s |
| worker CPU (10 pods) | 1.5–2.2 cores total | unchanged |
| active groups | 1,259–1,280 | 1,265 |

Every number follows from the first row:

```text
200-statement budget, ~1 s per statement
   -> ~195 statements/s drained
      -> 1,090 queued / 195 = 5.6 s wait
         -> job = 5.7 s waiting + 0.6 s working = 6.3 s
            -> 1,270 fleet slots / 6.3 s = 200 jobs/s
```

Two things are worth stating plainly about that table.

**Concurrency was never the constraint.** Active groups sat at ~1,270 the
entire time and worker CPU never moved off ~0.2 of a core per pod, on a
single-threaded runtime. The fleet was full of jobs that were all asleep
waiting for the same semaphore. Raising the dispatch budget — the intuitive
fix, and one we considered — would have admitted more jobs into a fleet with
no free slots and a saturated limiter. It would have made this worse.

**The blast radius was the whole platform, not the migration.** Mean job
duration during the window, by job type:

```text
executeEvaluation    ████████████████████ 20.7 s
metricTimeRollup     ███████████████ 15.5 s
canonicalLogStorage  ██████████████ 14.9 s
recordSpan           █████████████ 13.5 s   <- customer trace ingestion
authzGrantsWrite     ███████████ 11.6 s
```

Customer span ingestion took 13.5 seconds a job because a background
migration was allowed to hold all 200 statement slots. The statement limiter
(`server/clickhouse/statementLimit.ts`) is first-come, first-served: it bounds
total concurrency and bounds the wait queue, but it has no notion of what the
statement is *for*. A bulk backfill and a customer's trace write are peers.

## Decision

### 1. Grant commands ride a sharded per-organization lane

`attachGrant`, `revokeGrant` and `changeGrantRole` take a `getGroupKey` that
returns `hash(aggregateId) % 32` — the shard ALONE — plus a
`coalesceMaxBatch` so that a lane's queued commands fold into one multi-row
append.

The callback's result is not the queue key. `buildGroupKey`
(`queueManager.ts`) composes `${tenantId}/${jobPath}/${aggregateType}:${key}`,
so the organization is already in every key and the callback would only
repeat it. That is what makes these lanes per-organization without the
callback ever naming one:

```text
                    callback returns   final queue key
BEFORE (aggregate)  "grant_7Hk2mQ"     <org>/command/attachGrant/authz_grant:grant_7Hk2mQ
AFTER  (shard)      "14"               <org>/command/attachGrant/authz_grant:14
```

```text
BEFORE                          AFTER
one lane per grant              32 lanes per organization
  grant_7Hk2mQ -> 1 insert        lane 14 -> [grant_7Hk2mQ, ...] 1 insert
  grant_9Fs4tR -> 1 insert        lane 12 -> [grant_9Fs4tR, ...] 1 insert
     x 428,720                    ...

428,720 statements              ~8,500 statements at batch 50
1,270-way parallelism           32-way parallelism per organization
```

The shard count is the trade: lanes buy parallelism, batches buy statement
economy, and 32 is where an organization keeps enough of both. It is a
constant with a name, not a tuned magic number, and the reasoning for
changing it is recorded here.

**The fold is untouched.** ADR-110's aggregate stays the grant: fold state is
still one grant, still `authz_grant:<grantId>`. What changes is only which
queue lane a command *waits in* before it is handled. Aggregate identity and
lane identity were the same string by default; this separates them, which is
what the `getGroupKey` override on `CommandHandlerOptions` already exists for.

The commands qualify for coalescing on the ADR-066 contract without
modification: `grantsLedgerCommands.ts` says it in its own docblock — "the
grant commands are pure appends: validate, stamp identity, emit". Each handler
derives its event from its own command alone and never reads back a same-batch
append.

### 2. The statement budget is shared per producer, not first-come

**Deferred, with its design settled here.** Not implemented in the PR that
carries this ADR.

The first shape considered was a two-class split: statements are
`interactive` by default, a caller may declare itself `background`, and
background work may hold at most a fraction of the budget. Writing it down
killed it. `recordSpan` — the job whose 13.5-second latency is the reason
this matters — is queue work too. Any rule that classes "queue work" as
background starves customer ingestion alongside the migration and contains
nothing that actually happened here.

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
path every ClickHouse caller in the app crosses. Decision 1 removes the
pressure that made it urgent; this removes the class of incident. They are
not substitutes and the second one should not be rushed behind the first.

## Rationale / Trade-offs

**Why not raise the statement budget?** It is per-server on purpose and sized
to what ClickHouse itself will accept; raising it moves the queue from our
process into the database, where it is less visible and less recoverable. The
budget is not the bug. Consuming all of it for restated facts is.

**Why not just stop the restaging?** We are (PR #7429, the heads filter). But
that fixes one producer. The lane shape is what made *any* bulk producer on
this pipeline a platform-wide event, and the next migration would find it
again. ADR-110's measurement and this one are the same pipeline's
partitioning biting twice.

**Why 32 shards and batch 50?** 428,720 facts ÷ (32 × 50) ≈ 268 rounds; at
~1 s a statement that is a few minutes of appends rather than an afternoon,
while leaving 32 concurrent lanes per organization. Both are constants that
review may move; the ADR records the reasoning, not a claim of optimality.

**What we give up.** An organization's grant commands no longer run
1,270-wide. For interactive access changes this is invisible — they arrive
one at a time and coalesce to batches of one, which is the pre-existing path
unchanged. For bulk producers, 32 lanes of batched appends beats 1,270 lanes
of single appends by roughly the batch factor, because the constraint is
statements and never was slots.

## Consequences

- The migration's statement pressure falls by roughly the batch factor, so a
  bulk import stops being visible to unrelated pipelines.
- Until decision 2 lands, one producer can still exhaust the statement
  budget. Decision 1 makes that far harder for this pipeline and does
  nothing for the next one; the containment gap stays open and named.
- Grant commands for one organization serialize 32-ways rather than
  arbitrarily wide. Anything that assumed unbounded per-grant command
  parallelism would notice; nothing does today.
- `gq_parked_groups` and the dispatch budget are unchanged. Parking was not
  the constraint, and this ADR deliberately does not touch it.

## References

- `platform/app/src/server/event-sourcing/pipelines/authz-grants/pipeline.ts`
- `platform/app/src/server/event-sourcing/services/queues/queueManager.ts`
  (the group key: `${aggregateType}:${getAggregateId(payload)}`)
- `platform/app/src/server/clickhouse/statementLimit.ts`
- `specs/event-sourcing/authz-grant-command-lanes.feature`
- PR #7429 — the heads filter that stops the restaging at source
- ADR-110 — a grant is its own aggregate

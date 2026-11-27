# ADR-092: The queue lists each tenant's claimed groups; a replay asks it instead of scanning

**Status:** Proposed

> The group queue keeps a **per-tenant set of claimed groups**, written in the claim script and
> pruned on read. A projection replay's drain check reads that set through a **queue-owned script**,
> and trusts it only once the **upgrade ledger** says every writer maintains it and old claims are
> backfilled. Nothing on a live path walks the keyspace.

## Context

ADR-015 (`packages/eventing/adrs/015-projection-replay-coordination.md`) pauses the replayed lanes
for each batch and waits until work already admitted to them has finished. For map and state
projections, whose group ids end in a projection-defined key, that wait walked the whole Redis
keyspace with `SCAN … MATCH group:<tenant>/<kind>/<name>/*:active|:claimed`, once per tenant, twice
per check, every 200 ms. SCAN filters after reading, so each check cost keys / 500 calls whatever
the pattern said.

In production on 2026-11-25 the first deploy carrying the nurturing replay steps walked about 9,700
tenants over a 7.27 million-key database. SCAN took 48.7% of Redis CPU and claim scripts 21.1%. CPU
went from about 38% to about 85% at that minute and stayed there through the night. On a real Redis
with one million keys, one check for one tenant cost 3,998 SCAN calls; for 100 tenants it cost 399,800
calls and 88 s, longer than the 60 s drain timeout.

## Decision

1. **The queue owns the answer.** "Which groups of this tenant are still running?" is answered by
   `@langwatch/group-queue`, not by a caller reading the queue's key layout. The replay stops
   hard-coding `{event-sourcing/jobs}:gq:` and calls the queue. Rejected: keeping the knowledge in
   the replay. It already leaks the queue's storage into another package.
2. **Index per tenant, not per lane.** Key `<queue>:gq:tenant-claims:<tenant>`, a set of group ids,
   under the queue's hash tag (ADR-006). The tenant is the group id's first segment, read
   independently of the tenant cap. Rejected: per lane. Rebuild jobs (`projectionRebuild`,
   `stateProjectionRebuild`) run in the projection's own group under a lane the replay does not pause,
   so a per-lane set misses them. A group-id prefix filter catches every job in the group, as today.
3. **Membership lasts as long as a claim record or active key.** The claim branch of DISPATCH adds
   the group unconditionally and a heartbeat keeps the set alive. Completion, which deletes both
   `:active` and `:claimed`, removes it. Retry backoff deletes `:claimed` but re-sets `:active`, so it
   keeps the member. Every other release (recovery, dead-letter, operator drain, expiry) is left to
   the read: it returns members whose `:active` or `:claimed` key exists and removes the rest. The set
   expires with the claim records' 6 h key TTL, so a tenant nobody replays never accumulates. Rejected: reusing `tenant_active_z`. Its
   members lapse at the slot deadline by design (cap accounting), so a stalled worker's surviving
   claim would drop out, against `claimed-job-recovery.feature` ("A projection replay waits for a
   group holding a claimed record").
4. **Fold keeps its exact checks.** Fold group ids are rebuilt from the batch's aggregates
   (`replayDrain.ts` `foldGroupKey`), which is already exact and narrower than a tenant-wide read.
   Map and state use the index.
5. **Trusted only when the ledger says so; otherwise fail closed.** The index is ready when the
   backfill step `ops:fill-queue-tenant-claims` is done in the upgrade ledger _and_ every live
   process ships that step (the serving roster, as `oldWritersGoneFor` reads it). A rollback reopens
   the step, so readiness turns off with it. Readiness is a port supplied by the composition, like
   `EventLogIndexReadiness`: ops builds it from the ledger for operator replays. Deploy-time replays
   are ready by construction, since `defineProjectionReplayStep` now always declares
   `needsOldWritersGone` and runs after the backfill step; a guard test keeps that step the only
   caller of the deploy-time `replayLane`. When it is not ready, the drain fails the batch with a named error, and
   the batch retries on the replay's next run. Rejected: a Redis "ready" marker, which survives a
   rollback. Rejected: falling back to SCAN, which brings this incident back whenever readiness is
   off or not wired.
6. **Backfill once, budgeted.** `ops:fill-queue-tenant-claims` is a background step with
   `needsOldWritersGone: true`. It walks the keyspace once for `group:*:active` and `group:*:claimed`
   in slices of 200 SCAN calls, checkpointing the cursor between slices so a restart resumes, then
   adds each group to its tenant's set. It is the only
   keyspace walk this decision allows. Deploy-time projection replay steps declare it in `after`.
7. **No keyspace walks on live paths.** The lint rule `no-redis-keyspace-scan` refuses every walk
   spelling outside an allowlist of budgeted, operator-paced sweeps, each with its reason: `scan`
   and `scanBuffer` (with options, or on a Redis-named client), the stream and
   iterator forms, `keys`, a raw `call("SCAN"|"KEYS")`, and `SCAN`/`KEYS` inside a Lua source string
   (see Gates).

## Constants

| Name          | Value                               | Purpose                                              |
| ------------- | ----------------------------------- | ---------------------------------------------------- |
| index key     | `<queue>:gq:tenant-claims:<tenant>` | set of claimed group ids, same hash tag as the queue |
| backfill step | `ops:fill-queue-tenant-claims`      | fills the index for claims made before it existed    |
| drain poll    | 200 ms (unchanged)                  | each poll now costs one script call per tenant       |

## Invariants

| Invariant                 | Meaning                                                                                    | Test anchor                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Covers today's check      | Every group today's SCAN would find (`:active` or `:claimed` under the prefix) is returned | integration: running map, state, rebuild-lane and retry-backoff groups all block the drain |
| No live walk              | A drain check sends no SCAN                                                                | unit: the drain's Redis double records zero `scan` calls                                   |
| Cost follows running work | Calls per check grow with the tenant's claimed groups, not with database size              | bench: 1M unrelated keys, constant calls                                                   |
| Fail closed               | Without readiness the batch errors and never reports drained                               | unit: readiness off throws the named error                                                 |
| Self-healing              | A member whose keys are gone is removed on read                                            | integration: expired claim leaves no member after one read                                 |

## Assumptions

| Assumption                                                                                                                                   | What breaks if false                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Every `:active`/`:claimed` write goes through the claim branch or keeps an existing claim (heartbeat and retry are guarded by `gqOwnsClaim`) | A group could run unindexed. The lint and the round-3 code read cover today's writers. |
| Group ids start with `<tenant>/`                                                                                                             | An unprefixed group is not indexed, but replay prefixes always carry a tenant          |
| Replay runs on a standalone Redis (`live.replay-runtime.repository.ts` refuses a Cluster)                                                    | Not relied on: the key shares the hash tag either way                                  |

## Gates

| Path                       | Reversible?               | Blast radius              | Gate                                                                                    |
| -------------------------- | ------------------------- | ------------------------- | --------------------------------------------------------------------------------------- |
| Claim script adds one SADD | yes (revert)              | large: every job          | integration tests on real Redis plus a before/after bench of claim cost                 |
| Drain reads the index      | yes                       | large: replay correctness | the integration test that today's check and the index agree, plus fail-closed unit test |
| Backfill step              | yes (idempotent set adds) | small                     | `needsOldWritersGone`, sliced and checkpointed SCAN, rerunnable                         |
| Lint rule at error         | yes                       | small                     | the rule's fixture tests and a clean tree                                               |

## Rejected alternatives

- One SCAN per check for all tenants: still O(keys) per batch, about 9,700 batches per run.
- Slower polling only: about 10 times less load, same flaw.
- Pausing once per run: against ADR-015, it stops live data for hours.
- Workers registering their own group around processing: not atomic with the claim, so a job claimed just before the pause can be missed.

## Consequences

- Positive: the drain check costs a handful of calls. About half of production Redis CPU comes back.
  Batches stop timing out on large databases.
- Negative: one more set write per claim. During an upgrade, replays wait until the backfill is done.
- Negative, accepted: if an older image comes back while a replay step runs, its claims go unlisted
  and that run's drain may stop waiting early. The rollback reopens the step, which runs again.
- Neutral, pre-existing: a new rebuild job can still start after the check, because its lane is never
  paused. It is tracked separately.

## Open questions

- None blocking.

## Revisions

- v1, 2026-11-26: drafted from the production incident. The per-lane design died to the rebuild-lane
  case (correctness refuter). `tenant_active_z` reuse lost to claim lifetime. A Redis readiness marker
  lost to rollback (round-3 judge). Captain: Sergio Esteban.
- v2, 2026-11-26: the lint rule widened to bare-cursor scans, `keys` and Lua `SCAN`/`KEYS` after the
  verifier found those spellings slipped through v1's MATCH/COUNT check. Captain: Sergio Esteban.
- v3, 2026-11-27: review round. The deploy-time replayer's trust is pinned by a sole-caller guard
  test; the lint rule also catches raw `call("SCAN")` and spaced Lua calls; the backfill is called
  sliced, not paced; the older-image rollback risk is recorded. Captain: Sergio Esteban.

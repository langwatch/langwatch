# Redis group queue performance plan

Design only, based on the uncommitted `feat/redis-queue-perf` tree on 19 October 2026. Keep those changes intact. No production edits, commits or stashes are part of this task.

## Evidence and target

Reduce Redis CPU per accepted job and per stored span without weakening delivery, ordering or recovery. Queue mechanics stay in `packages/group-queue`; command routing stays in `packages/eventing`; span admission stays in `modules/trace`. Follow [Architecture §§2 and 9](../ARCHITECTURE.md), [queue hash tags](../../../packages/group-queue/adrs/006-redis-cluster-hash-tags.md), and the queue's pending-counter, claimed-job-recovery, staged-job-id-identity, settling-window and cross-group-batch specs.

Evidence read in full:

- Measured report: `/Users/lw/.config/agtop/tmp/langwatch-74bd14fb/bfececc3/lua/report.md`, size-prod, round 12, about 1,200 spans/s offered, Redis limited to one CPU.
- Earlier static review: `/Users/lw/.config/agtop/tmp/langwatch-74bd14fb/0be9f1ca/lua/astra-review.md`. Its priorities are superseded by measurements below.

Scripts consume about 41% of one core: 4,700 EVALSHA/s at 88 µs. The 2% `os.clock` sample attributes 51.6% of script CPU to single stage (55 µs, 16.6 calls), 15.3% to stageBatch (102 µs, 36.3 calls, about four jobs), 13.6% to dispatch (3,113 µs, 873 calls), 11.8% to drain (134 µs, 40.8 calls), and 6.1% to complete (40 µs). `redis.call` argument construction, lookup, reply conversion, string interning and hashing dominate; command bodies cost roughly 1 µs. Closure creation is only 0.2%.

The report's plain-build SLOWLOG window is different: stage averages 345 µs and dispatch 7,359 µs there. Do not substitute these elapsed times for sampled CPU, add nested command time to EVALSHA time, or treat offered throughput as stored throughput. An RDB child consumed about 40% of one perf sample within the same CPU limit. That is a separate, intermittent cost.

Memory is 555 MB over 424k keys, including about 230k small dedup strings and 93k groups with a hash and zset each. The pending index has 101k members versus 93k ready groups; this alone does not prove a leak, since blocked, parked and delayed work also belongs in pending.

## Priority by estimated Redis time saved

These are hypotheses at the measured workload, not promised speed-ups. A core percentage point means 10 ms CPU/s. Ranges overlap, so re-rank after each profile. Do not add overlapping estimates, particularly staging changes after more work moves to stageBatch.

| Rank | Slice | Estimate from the profile |
| --- | --- | --- |
| 1 | P1: batch ingest staging | 55 to about 25.5 µs/job at four jobs: roughly 54% of converted single-stage CPU. If all that traffic converts, about 28% of script CPU or 11.4 core points; multiply by the measured convertible fraction. |
| 2 | P2: dispatch less work, reuse its body | Body reuse alone removes 109.5 µs/run, 0.48% of script CPU or 0.20 core points. Avoiding half to all of the 49.15 excess candidates could remove another 275 to 551 µs/run across four sites. Combined upper opportunity about 1.7 to 2.9% of script CPU, 0.7 to 1.2 core points, before new bookkeeping. |
| 3 | P3: aggregate drain writes | Five repeated write sites cost 37.1 µs/run. Collapsing 6.46 repetitions to one gives a rough 31 µs upper opportunity; target 20 to 30 µs after argument costs, about 1.8 to 2.6% of script CPU or 0.7 to 1.1 core points. |
| 4 | P4: aggregate stageBatch work | Latest-score read and two TTL writes cost 15 µs/batch. Four jobs in one group could save about 11 µs there; distinct groups save none. HSET/ZADD cost another 16 µs, partly reducible. Target 5 to 20 µs on suitable batches, about 0.8 to 3.0% of current script CPU or 0.3 to 1.2 core points. Measure group repetition before choosing the upper end. |
| 5 | P5: stop routine full ready scans | 591.5 ms over 43 ZSCAN pages per pass. At one pass/minute this is about 0.99 core points of elapsed Redis command time, an upper opportunity, not the window's 20.8% as a sustained saving. Replacement work remains. |
| 6 | P6: dedup memory experiment | No CPU saving established. Every measured 16 bytes saved across 230k keys is about 3.7 MB; 64 bytes is 14.7 MB. Actual allocator and expiry overhead must be sampled. |
| Separate | P7: persistence experiment | Potentially large during saves, unquantified over a full cycle. The 40% sample is neither an average nor an additive queue-script saving. |

The mid-ranked ranges are close. P2 starts with its small, low-risk body reuse; P4 can run before the more involved P2 scan change if P1 produces repeated-group batches.

## Rules shared by every slice

- A successful stage acknowledges Redis acceptance. No early acknowledgement from an in-memory buffer. Keep stable staged IDs, original job scores, tie ordering, delays, settling, dedup flags, tenant routing, preflight registration, audit and per-item failure results.
- Stage, claim, recovery and counter changes remain atomic within the queue's slot. `total-pending` counts members of live `:jobs` zsets, not claimed or DLQ jobs. Count actual insertions/removals. Keep claimed bodies and original scores until a fenced outcome; a dead worker's next claimant recovers them before later jobs.
- Lua isolation does not provide rollback after a runtime error. Validate bounded inputs before writes, retain retry-safe IDs and handle a lost reply as an unknown outcome. Test replay after Redis accepted a command but the caller did not see its reply.
- Keep one queue hash tag across jobs, bodies, dedup, counters, leases and indexes. Never combine queues or arbitrary span-dedup keys in one script. Declare known accessed keys in `KEYS`. Current dispatch and stageBatch derive keys from prefixes and stored IDs, an existing gap against Redis's [key argument rules](https://redis.io/docs/latest/develop/programmability/eval-intro/). Same-slot tests do not prove resharding safety. New batch boundaries must enumerate known keys; test existing discovery-based dispatch under cluster movement and record its limit rather than claiming to fix it here.
- Retain `CachedLuaScript` and its cancellation-aware NOSCRIPT recovery. `ScriptCallBatcher` and `completeMany` currently pipeline separate EVALSHA calls, saving round trips rather than script invocations. Do not count them as true Lua batching.

In the test lists below, `GQ/` means `packages/group-queue/src/__tests__/`; `OPS/` means `modules/ops/process/src/repositories/redis/__tests__/`. All named files already exist unless labelled new.

## Performance slices

### P1a. Add bounded staging of prepared jobs

**Files/functions:** `packages/group-queue/src/groupQueue.ts` (`send`, `sendBatch`, preparation and result handling), `scripts.ts` (`GroupStagingScripts.stageBatch`, `STAGE_BATCH_LUA`); eventing `queues/queue.types.ts`, `services/queues/queueManager.ts` command facade and `queues/groupQueueFactory.ts` where the new result/score path needs forwarding.

Extract preparation that retains each single send's score, context and options, then stage prepared jobs in bounded batches. Start with at most 64 jobs and a separately measured encoded-byte ceiling; a large legal job may travel alone. Return index-aligned outcomes as well as the existing count so metrics and audit retain single-send meaning. Keep current public `sendBatch` behaviour for existing callers: it adds `index` milliseconds to scores and audits every input, which is not interchangeable with repeated `send`.

Process duplicate staged IDs and dedup IDs in input order. Preserve extend/replace/survive-dispatch behaviour and atomic blob lease transfer. Bound preparation concurrency and flush on close. No new timer is needed for an explicit request batch. A singleton can keep `stage`; a next-tick collector cannot batch a loop that awaits each send.

**Tests:** extend `GQ/scripts.integration.test.ts`, `stagedJobIdIdentity.integration.test.ts`, `record-span-dedup-identity.integration.test.ts`, `settling-window.integration.test.ts`, `pending-counter-conservation.integration.test.ts` and `payload-store-blob-hardening.integration.test.ts`. Compare single and prepared-batch state for repeated IDs, all dedup flags, equal scores, active/blocked groups, mixed inline/blob values and a lost reply. Unit coverage in `GQ/groupQueue.drainSendGate.unit.test.ts`, plus a new prepared-stage result test, covers chunk limits, outcome alignment, context, audit and close. Extend eventing's `queueManager.readyScore.unit.test.ts` and `queueManager.test.ts` for routing/forwarding.

**Verify:** common profile procedure below, initially with direct four-job batches and singleton controls. Savings are realised in P1b, not claimed twice here.

### P1b. Use the batch at trace admission

**Call path today:** `TraceSpanCollectionService.collectBatch` in `modules/trace/process/src/features/ingestion/services/trace-ingestion.service.ts` batches dedup claims but awaits `collectClaimed` per span. That calls `TraceIngressCommand.recordSpan`, through trace's adapter in `app/trace.app.ts` and `TraceProcessingCommandsService.recordSpan` in `services/trace-processing-commands.service.ts`, then eventing's command facade, global queue, `GroupQueueProcessor.send` and `scripts.stage`. Eventing's `projections/projectionRouter.ts` already uses `sendBatch` for several fan-outs, but also has single sends. Measure origin counts rather than attributing all 52% to trace admission.

Add a typed batch path through those trace-owned adapters to P1a. Prepare and validate spans individually, retain their input positions, then submit accepted spans in bounded chunks. Confirm span dedup only for accepted results; release acquired claims for failed inputs. Unknown Redis outcomes remain retryable with the same identity. Do not bypass command validation, preflight or eventing's durable hand-off. Keep the current group/shard selection in `eventing/trace-processing-projections.pipeline.ts` and the 30-second replace/extend dedup in `eventing/record-span.commands.ts`.

**Tests:** extend trace's `features/ingestion/services/__tests__/trace-ingestion.service.unit.test.ts` for mixed held/acquired/unknown claims, preparation failures, partial chunk failure and confirmation timing. Extend `transport/__tests__/otlp-span-resend.integration.test.ts` and `otlp-ingest-rest.composition.integration.test.ts` to send multi-span requests and retry after a lost reply, asserting stored identities and response results. Include P1a's real-Redis identity tests.

**Verify:** expect fewer single-stage invocations per admitted span and larger stageBatch sizes, without higher duplicate writes or ingestion failures. Record the fraction converted and calculate `0.41 × 0.516 × fraction × (55 - measured µs/job)/55`. Do not promise the full 11.4 points if many single stages are retries or other lanes. Singleton-heavy workloads may instead justify a cheaper scalar path after profiling; do not remove dedup to make one.

### P2a. Read the dispatch body once

**Files/functions:** `scripts.ts`, `DISPATCH_BATCH_LUA.scanBatch`.

Reuse `headJson` and its parsed routing fields at claim time. Track whether it was fetched separately from its value, so a missing body does not cause a second HGET. The atomic invocation cannot observe a changed body. Preserve missing-body handling and the claimed recovery copy. No key-layout change.

**Tests:** extend `GQ/cross-group-batch.integration.test.ts`, `group-queue.pause.integration.test.ts` and `claimed-job-recovery.integration.test.ts` for paused routes, missing bodies, inline/blob envelopes and crash recovery. Add a focused unit assertion of the fetched/missing distinction; real Redis remains the behavioural proof.

**Verify:** the second HGET site, measured at 109.5 µs/run, disappears; the first remains. Compare dispatch CPU at equal claim counts.

### P2b. Stop examining groups that cannot fill the batch

**Files/functions:** `scripts.ts` (`DISPATCH_BATCH_LUA.scanBatch`, `RETRY_RESTAGE_LUA`, parking/reconcile helpers); `dispatcher.ts` (`claim`, `dispatchUntilEmpty`, signal waits).

Instrument rejection reasons first. Of 78.75 candidates reaching GET-active/recovery/head reads, only 29.6 are claimed. Many may have the wrong route for remaining batch room; they are not all active-lock failures. Add a total examination budget across ordinary and override scans, with a smaller budget for filling spare room after all execution slots are filled. Return a continuation hint so a bounded short claim does not sleep as if the queue were empty. Rotate skipped candidates with a durable cursor/tie position without changing job scores, and preserve access to quiet tenants behind a busy prefix. Do not introduce a route index until measured routing misses justify its maintenance cost.

Align retry ready time to the actual active-lock expiry, including the existing rounding/buffer, rather than shortening the lock. An observed legacy due-but-active group may be re-scored from PTTL. Keep heartbeat cancellation before retry. Within one script cache numeric tenant counts and update them after each claim; never cache ownership, pause state or caps in Node. Retain recovery HGETALL: adding EXISTS first does not remove its common-path cost. Bound parking maintenance across the invocation, preserving the two-second recovery cadence and prompt unpause.

Close the enqueue-between-empty-result-and-signal-DEL race before reducing notifications or increasing waits. Consume old notifications before the atomic claim/check, leave later notifications available, and wake on freed capacity as well as new work. Keep a timed recovery fallback. No per-pod unbounded scan or maintenance loop.

**Tests:** extend `GQ/tenant-soft-cap.integration.test.ts`, `tenant-pause-parking.integration.test.ts`, `readyScore.dispatchOrder.integration.test.ts`, `cross-group-batch.integration.test.ts`, `listed-run-scan-cost.integration.test.ts` and `scripts.retryRestage.integration.test.ts`. Cover a long incompatible-route prefix, quiet-tenant service, cap-off recovery, worker death, cursor restart and backoff expiry. Unit tests: `dispatcher.signal.unit.test.ts`, `dispatcher.settle.unit.test.ts`, `dispatcher.listed.unit.test.ts`. Require bounded progress over successive calls and no idle runnable backlog, not merely fewer candidates per call.

**Verify:** report examinations/claim, rejection reasons, calls and CPU per successful claim, empty dispatches/pod, fairness and p99 delay. Halving excess reads is an experiment, not an acceptance substitute for throughput. Repeat at 1, 2 and 4 workers, including 0.5 CPU Redis where four pods previously collapsed to about 20 spans/s.

### P3. Collapse drain mutations

**Files/functions:** `scripts.ts` (`DRAIN_GROUP_LUA`, `gqHoldClaimedJob`); retain `groupQueue.ts`'s `drainMatchingSiblings` policy.

After checking the claim token, read in score order and select the accepted prefix under `maxJobs` and the byte budget. Write all accepted score/body fields with bounded multi-field HSET, then one PEXPIRE for the claim, multi-member ZREM, multi-field HDEL and DECRBY by the actual removal count. Do not decrement by body count: missing-body jobs still occupy the zset. Never delete a job that fails the byte check or skip it to take a smaller later job. Keep scalar HGET initially; bounded HMGET is a separate experiment because it may read large bodies beyond the accepted prefix. The claim's existing token and original scores remain intact.

**Tests:** extend `GQ/group-queue.coalescing.integration.test.ts`, `claimed-job-recovery.integration.test.ts`, `pending-counter-conservation.integration.test.ts`, `batch-bisection.integration.test.ts` and `scripts.integration.test.ts`. Cover zero jobs, missing bodies, first overflow, stale tokens, tokenless compatibility, death after drain and large argument chunks. Add unit coverage for bounded argument construction if extracted.

**Verify:** the five write sites fall from 6.46 calls each to about one on an unchunked run; HGET remains. Measure actual CPU, reply bytes and SLOWLOG tails, not just command count.

### P4. Collapse stageBatch work by affected group

**Files/functions:** `scripts.ts` (`STAGE_BATCH_LUA`, `refreshGroupKeyTtl`, `gqMarkPending`, lease helpers).

First move final TTL refresh and pending-index marking to one pass per affected group. Compute TTL from the final latest score and preserve blocked persistence (C1). Read Redis TIME lazily once for lease work. Then aggregate fresh independent writes into multi-field HSET and multi-member ZADD per group. Flush pending writes before a later input needs to inspect the same staged or dedup ID, or maintain an equivalent in-script view; naïve delayed writes break replace/extend and displaced-lease handling. Retain sequential handling for dependent inputs. Keep one total INCRBY based on actual insertions, one ready update per group, and one signal per batch. Bound all argument arrays.

`restageDrainedSiblings` still uses single stages deliberately: `stageBatch` has no claim-token guard. A later sibling batch needs its own fenced entry point, not a blind substitution.

**Tests:** extend `GQ/scripts.integration.test.ts`, `pending-counter-conservation.integration.test.ts`, `readyScore.dispatchOrder.integration.test.ts`, `settling-window.integration.test.ts` and `blob-leases.integration.test.ts`; cover repeated IDs, multiple dedup IDs targeting one job, replace/extend combinations, post-dispatch suppression, shared blobs, long delay and blocked arrivals. Unit-test chunk boundaries/result alignment in the P1a tests.

**Verify:** split profiles by jobs and distinct groups per batch. TTL calls become two per live group, latest-score reads one per group, and grouped writes reduce only where safe. Compare before and after P1b on the same traffic mix.

### P5. Make pending reconciliation exceptional work

**Files/functions:** `modules/ops/process/src/repositories/redis/queue.repository.ts` (`reconcileTotalPending`, `collectPendingGroupIds`, `collectIndexMembers`, `prunePendingIndex`); queue `scripts.ts` lifecycle transitions.

Retain the pending index as a superset. Remove a group atomically only when its live jobs are empty, and ensure every insertion/recovery path re-adds it. Roll this out before making the routine pass use that index alone. Keep ready/blocked/parked discovery and keyspace scanning for initial adoption, old-writer overlap, reported drift and a slower backstop. Persist bounded scan progress under the existing single-flight lease; after a crash resume or restart safely, never publish a partial total. A multi-page sum is not a snapshot: preserve or strengthen concurrent-write protection, and do not replace the live counter with an unchecked stale sum.

**Tests:** extend `OPS/redis.queue.repository.reconcile-pending.unit.test.ts`, `pending-counter-reconcile.integration.test.ts`, `operator-recovery-counters.integration.test.ts` and `GQ/pending-counter-conservation.integration.test.ts`. Cover arrivals between scan/prune/publication, absent indexes, old writers, lease loss and cursor restart. Pruning must recheck Redis state atomically.

**Verify:** count ZSCAN pages and elapsed time over whole minutes, including adoption/backstop passes. Target removal of the routine 43-page ready scan only after coverage is proven. Measure added lifecycle SREM cost and pending-index memory; correctness must not depend on the dashboard repairing drift.

### P6. Measure dedup memory before changing its layout

**Files/functions:** trace `repositories/redis/redis.trace-span-dedup.repository.ts` (`claimProcessing`, `confirmProcessed`, `releaseOnFailure`); queue `scripts.ts` dedup branches and key construction.

Sample MEMORY USAGE, OBJECT ENCODING, key lengths and TTL distributions separately for `span_dedup:*` and queue `dedup:*`. Span dedup uses a 60-second processing claim and one-hour confirmation; queue dedup stores the staged job ID for replace/extend and may survive dispatch. They are different guarantees and cannot simply be merged or removed.

Prototype bounded hash buckets with independent field deadlines only after checking every supported Redis version. Compare against existing strings, including expiry CPU and large-hash lookup cost. Whole-hash expiry renewed on every insert is unacceptable. Preserve exact expiry, NX claim behaviour, identity and queue replacement semantics; do not shorten TTLs to manufacture a saving. Keep arbitrary span keys out of queue-slot scripts. A layout change needs an explicit rollout design: old keys are frozen, and dual reads/writes across their existing slots are not atomic. Keep old keys authoritative during overlap, wait out old writers and the full dedup window, then switch behind a version gate; rollback must still see live claims. Do not ship the layout until that protocol is proven.

**Tests:** extend trace's `repositories/redis/__tests__/redis.trace-span-dedup.repository.unit.test.ts`, `transport/__tests__/otlp-span-resend.integration.test.ts`, `GQ/record-span-dedup-identity.integration.test.ts` and `scripts.integration.test.ts`; add a real-Redis span-dedup repository integration suite for expiry boundaries, concurrent claims, failed release, mixed versions and cluster slots.

**Verify:** bytes per live identity, total keys/RSS, expiry CPU and dedup outcomes over a full one-hour window. Re-profile stage GET/SET sites. Keep strings if command cost or migration risk outweighs measured memory savings.

### P7. Measure and expose chart persistence deliberately

**Files:** `charts/langwatch/templates/redis/statefulset.yaml`, `values.yaml`, generated chart documentation and a new `tests/redis-persistence.sh`; extend `tests/e2e-full-stack.sh` for restart verification.

The chart currently passes `--maxmemory-policy noeviction`, mounts `/data`, and exposes PVC sizing, but does not explicitly set RDB/AOF policy. Record effective `save`, `appendonly`, `appendfsync`, image version, storage and CPU throttling first. Compare the current policy, changed snapshot cadence and AOF every-second with/without snapshots on disposable load runs. Include background save/rewrite cycles and fork/copy-on-write memory. Redis documents the distinct durability and fork costs in its [persistence guide](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/).

Expose measured choices consistently for authenticated and unauthenticated startup. Keep defaults until restart tests and an explicit recovery-point decision support a change. A persistence-disabled run is a diagnostic control, not a production recommendation: accepted queue work may not yet be in the event log. Keep noeviction and PVCs. Queue atomicity, dedup and slots stay unchanged; Redis crash durability does not.

**Tests/verify:** chart render assertions for both auth modes and external Redis; graceful restart and forced termination with accepted pending, claimed and dedup state. Measure recovered/lost jobs against the declared durability window. Repeat the common profile with and without a save in progress; report parent and child CPU separately and amortised over full persistence cycles.

## Correctness fixes, separate from performance claims

Each fix is a separate slice with no CPU-saving claim. Run the common profile as a regression check. All queue mutations and new lease/index keys retain the queue hash tag and are fenced before side effects.

### C1. Blocked jobs must stay persistent

`RESTAGE_AND_BLOCK_LUA` PERSISTs jobs/data, but both stage paths call `refreshGroupKeyTtl` before the blocked decision and restore expiry. Make the TTL helper take blocked state and preserve persistence, including dedup replacement and replay into a blocked group. Unblock restores TTL from the final latest score. Extend `GQ/scripts.integration.test.ts` and `scripts.retryRestage.integration.test.ts`: block, stage singly/in a batch, squash, verify both PTTLs remain -1 and later unblock can process every job. Unit-test the wrapper arguments. Land before P4.

### C2. Referenced bytes must outlive DLQ and blocked records

`deadLetter.ts` keeps envelopes seven days, while `blobConstants.ts` gives leases three days and Redis blobs four. More arrivals can extend the whole DLQ group's TTL, so merely changing constants to seven days is insufficient. Fix lease transitions in `deadLetter.ts`, `scripts.ts`, `blobLeases.ts` and `envelopeBlobLifecycle.ts`: retain references to the group's actual retention deadline, extending all affected blob protections when that deadline moves. Persistently blocked work needs a durable pin, not a finite lease whose renewal depends on a running worker. Delayed jobs need protection through due time plus recovery margin. Ordinary renewals must never shorten longer protection; shared blobs stay until every live reference is gone. Transfer protection before removing source ownership; discard/replay/expiry retire only their own references. Include object-storage retention and any trace spool reference, not only Redis bytes.

Land as C2a for finite DLQ/delay deadlines and C2b for persistent blocked pins, both with old-reader compatibility and cleanup. Extend `GQ/group-queue.dead-letter.integration.test.ts`, `blob-leases.integration.test.ts`, `payload-store-blob-hardening.integration.test.ts` and `blob-sweeper.integration.test.ts`; shorten test deadlines to cover seven-day-equivalent replay, repeated DLQ arrivals, shared bodies, a stopped fleet, discard and crash between transitions. Extend `GQ/blobLeases.unit.test.ts` for deadline/pin rules. Verify replay returns original bytes, and eventual cleanup frees unreferenced bytes. Deploy the sweep guard in C5 first.

### C3. Fence before releasing the poison marker

In `scripts.ts`, COMPLETE, RETRY_RESTAGE and RESTAGE_AND_BLOCK call `gqReleaseClaimMarker` before checking ownership. Move all release effects after a successful guard and bind release to the accepted claim, not just worker ID. Preserve explicit tokenless compatibility. Extend `GQ/groupQueue.poisonGuard.integration.test.ts` and `claimed-job-recovery.integration.test.ts`: a late outcome from the same worker identity but an old token leaves a newer marker, deaths, counters and bodies untouched. Extend `processClaimedJob.characterization.unit.test.ts` for outcome ordering. No ordering or dedup policy changes.

### C4. Conserve pending through DLQ moves and replay

`deadLetter.ts` whole-group MOVE and REPLAY omit pending deltas. Pass the counter as a key; subtract actual live jobs removed on move, excluding already-claimed jobs, and add only new live zset members on replay. Repeated moves/replays and destination collisions must not drift. Update ops callers, preserve stored scores, and keep pending/DLQ membership in the same transition. Prune expired DLQ index members only after atomically confirming no live DLQ entry. Extend `GQ/pending-counter-conservation.integration.test.ts`, `group-queue.dead-letter.integration.test.ts`, `OPS/operator-recovery-counters.integration.test.ts`, `dlq-dead-lettered-job.integration.test.ts` and `redis.queue.repository.dlq-groups.unit.test.ts`. Assert counters before any reconciliation and after worker death/replay. Land before P5.

### C5. Sweep must respect legacy holders and dry-run

`blobSweepLua.ts` ignores holders that `blobGraceLua.ts` attempts to protect; dry-run still prunes leases. Share a liveness rule that distinguishes the sentinel from actual legacy holders, including a set with one holder and no sentinel. Refuse shortening/deletion while any real holder exists. Use read-only live-lease counting for dry-run. Do not remove compatibility mirroring until old workers are gone. Extend `GQ/blob-sweeper.integration.test.ts`, `blob-leases.integration.test.ts` and `blobLeases.unit.test.ts`: legacy-only holder, sentinel-only set, expired lease with holder, shared blob, dry-run key/member/TTL preservation. Verify cleanup still completes after the last real reference retires.

## Landing order and verification

1. **Baseline:** record source diff/build identity, script SHA map, Redis config and workload. Add bounded reason/batch-size counters needed by the experiments. Establish repeat-run variance.
2. **Safety:** C1, C3, C4 and C5 independently; C2a/C2b as separate retention changes with their own rollout gates. Do not couple them to a performance threshold.
3. **Largest gain:** P1a then P1b. Each leaves existing scalar callers usable. Re-profile before changing Lua internals.
4. **Small script slices:** P2a, P3, then P4's per-group TTL pass and grouped writes separately. Each has its named tests and its own before/after profile.
5. **Bounded scanning:** P2b in separate retry-score, notification, and scan-budget changes; verify each. Then P5 after index adoption. Re-rank using measured savings.
6. **Conditional changes:** P6 and P7 begin as experiments. Ship a layout or default only when its compatibility/durability gate passes. Keep reverting performance code possible without reverting correctness fixes or losing readable stored state.

For **each** slice, use the same size-prod workload, seed, payload distribution, Redis resources and worker count. Warm up, run several equal windows, and compare at equal successful throughput as well as at saturation. Capture:

- Plain build: 60-second commandstats deltas and SLOWLOG grouped by the new SHA map, including counts, total time and tails. Drain SLOWLOG outside the timed window: its own collection cost 42 ms in the report. Report threshold/truncation so a thresholded log is not mistaken for an unbiased invocation census.
- Instrumented build: the same 2% `os.clock` per-call-site sampling; report CPU/run, calls/run, CPU/job, jobs/batch, distinct groups/batch and claims/examinations. Generated Lua line numbers change, so map sites by operation as well as line. Use perf to distinguish Lua machinery, command bodies and persistence children.
- Outcomes: admitted and stored spans/s, backlog slope, enqueue-to-store p95/p99, retries, drops, duplicate writes, empty claims/drains, Redis CPU/throttling and memory. Run long enough to include reconciliation and persistence cycles. A lower commands/stored-span ratio caused by a changed denominator is not proof.

Accept a performance slice when repeated runs beat baseline CPU per successful unit beyond observed variance, without lower useful throughput, worse recovery, unfair dispatch or a material latency regression. Repeat the final 1/2/4-worker matrix on both 1 CPU and 0.5 CPU Redis. Preserve raw results beside the experiment record; no speed-up is established by this plan alone.

Before implementation, add or extend bound spec scenarios for the behaviour being changed. Run the named unit and real-Redis integration files through their owning package (`VITEST_MAX_WORKERS=2 pnpm --filter <package> test ...` or its `test:integration` script), package typechecks, scoped Oxfmt/Oxc, affected architecture policies, changed-test quality review and `git diff --check`. Extend hash-slot checks and add real cluster restart/failover/resharding coverage for changed script boundaries; the current `redisHashTag.unit.test.ts` only checks tag syntax.

Defer Redis Functions, helper-closure splitting, broad completion/heartbeat batching and claimed-record layout changes. Completion's entire measured pool is only 6.1%, closure creation 0.2%, and pipelining is already present. Reconsider them only if the new profile makes their remaining cost worthwhile.

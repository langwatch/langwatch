# GroupQueue — Usage Guide

The in-house queue that backs every event-sourcing pipeline: per-aggregate FIFO, cross-aggregate parallelism, tiered payload storage, content-addressed dedup across fan-outs. Built on Redis primitives + Lua, no BullMQ.

For the technical overview (how the staging Lua, the dispatcher, the tiered storage, and the holder refcount actually work), see [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## When to Use It

Reach for GroupQueue when **any** of these is true:

- You need **per-aggregate FIFO**: event N for an aggregate must finish before event N+1 starts. This is the canonical fold-projection requirement.
- You want **content-sharing across fan-out**: the same event dispatched to many reactors should not pay N× the Redis memory cost.
- You expect **payloads up to ~50 MiB**: small payloads inline, big ones offload to S3 — no separate code path per size.
- You want a **predictable retry path** that preserves FIFO within a group.

Reach for something else when:

- The work is fire-and-forget with no ordering constraint and no fan-out — a plain BullMQ queue (or a cron) is fine.
- You need **cross-aggregate ordering** (i.e. a global pipeline). GroupQueue's parallelism story explicitly assumes aggregates are independent.
- You need **scheduled / cron jobs**. Use a scheduler.
- Payloads are routinely > 50 MiB. The hard cap exists to bound worker memory — push the data to its own storage path (S3, blob, ClickHouse) and pass a reference.

---

## Quick Start: Using It Indirectly

You almost never instantiate `GroupQueueProcessor` directly. The framework wires one up per pipeline in the composition root ([`eventSourcing.ts`](../../eventSourcing.ts)), and you declare what runs on it through the `definePipeline()` builder:

```typescript
import { definePipeline } from "~/server/event-sourcing";

const pipeline = definePipeline<TraceEvent>()
  .withName("trace_processing")
  .withAggregateType("trace")
  .withFoldProjection("summary", traceSummaryFoldProjection)
  .withReactor("summary", "syncToSearch", searchSyncReactor)
  .build();
```

The fold projection's events flow through a GroupQueue keyed by `aggregateId`, so events for the same trace process in order. Different traces parallelise across the worker fleet.

See the parent [`event-sourcing/README.md`](../../README.md) for the full builder API.

---

## Quick Start: Using It Directly

You only instantiate `GroupQueueProcessor` when building a new queue surface outside the event-sourcing framework — rare. The shape:

```typescript
import { GroupQueueProcessor } from "~/server/event-sourcing/queues/groupQueue/groupQueue";
import { connection } from "~/server/redis";
import { createStorageRegistry } from "~/server/stored-objects/stored-objects-factory";
import { resolveProjectStorageDestination } from "~/server/stored-objects/project-storage-destination";

const queue = new GroupQueueProcessor<MyPayload>(
  {
    name: "{my-feature/processor}",  // hash-tagged for Redis Cluster
    groupKey: (payload) => payload.aggregateId,
    process: async (payload) => { /* handle one job */ },
    options: { globalConcurrency: 50 },
  },
  connection,
  {
    consumerEnabled: processRole === "worker",
    objectStoreFor: (projectId) => createStorageRegistry({ projectId }),
    resolveStorageDestination: resolveProjectStorageDestination,
  },
);

await queue.waitUntilReady();
await queue.send({ aggregateId: "abc", data: "..." });
```

The two notable things:

- **The queue name must be hash-tagged** (`{...}`) so every Redis key for this queue lands in the same Redis Cluster slot. This is what lets the staging Lua touch multiple keys atomically.
- **`consumerEnabled: false`** for web processes — they should stage jobs but never dispatch them. Workers run with `consumerEnabled: true` (the default).

---

## Process Roles

| Role | What it does | `consumerEnabled` |
|---|---|---|
| `web` | Stages jobs via `send`/`sendBatch`. No dispatcher loop, no `fastq` processor. | `false` |
| `worker` | Stages AND dispatches. Runs the BRPOP signal loop, the local concurrency processor, and the metrics collector. | `true` |

A web pod that accidentally runs with `consumerEnabled: true` will pull jobs off the staging layer and process them on the web tier — usually not what you want (different scaling, different latency budget, no autoscaler tuning). The composition root reads `processRole` from config and sets this for you.

---

## Configuration

### Per-queue (in `EventSourcedQueueDefinition`)

| Field | Default | Purpose |
|---|---|---|
| `name` | required | Hash-tagged queue name; controls Redis key prefix |
| `groupKey(payload)` | required | Returns the group ID — events with the same ID are FIFO-ordered |
| `process(payload)` | required | Single-job handler |
| `processBatch(payloads[])` | optional | Batch handler — opt into coalescing |
| `coalesceMaxBatch(payload)` | optional | Per-payload coalescing limit |
| `groupKey`'s tenant inference | derived | The group ID prefix should embed the tenant (`tenantId/aggregateId`) so the dispatcher's tenant rate tracker works |
| `score(payload)` | `Date.now()` | When the job becomes eligible — use for delayed work |
| `deduplication` | none | Dedup mode (see below) |
| `delay` (option) | none | Constant delay added to score |
| `spanAttributes(payload)` | optional | Returns custom span attributes for the dispatch span |
| `options.globalConcurrency` | 100 | Max parallel groups processed on this node |

### Dedup modes

```typescript
// 1. No dedup — every send stages a new job (default)
.withProjection("X", definition)

// 2. By aggregate — only the latest event per aggregate within the TTL window
.withProjection("X", definition, {
  deduplication: "aggregate",
  delay: 1500,                       // optional debounce delay
})

// 3. Custom
.withProjection("X", definition, {
  deduplication: {
    makeId: (payload) => `${payload.tenantId}:${payload.kind}:${payload.targetId}`,
    ttlMs: 500,
    extend: true,                    // reset TTL on each new send
    replace: true,                   // overwrite the staged value
  },
})
```

Dedup is implemented inside the staging Lua — atomic with the rest of the stage, no race window where a duplicate slips through.

### Coalescing

For pipelines where multiple jobs in the same group can be processed together (e.g. inserting N rows in one ClickHouse `INSERT`):

```typescript
{
  name: "{trace/spanIngest}",
  groupKey: (p) => `${p.tenantId}/${p.traceId}`,
  process: async (p) => { /* fallback if batch handler isn't preferred */ },
  processBatch: async (batch) => { /* one INSERT for the lot */ },
  coalesceMaxBatch: (p) => 50,        // up to 50 per dispatch
}
```

The drain happens atomically inside `DISPATCH_LUA`. If `processBatch` throws, every job in the batch is re-staged (preserving FIFO order at the head of the group).

---

## Tiered Storage: What to Expect

Payloads of different sizes land in different places, picked at encode time. You don't configure this per send — the encoder picks based on serialized size. See [ARCHITECTURE.md](./ARCHITECTURE.md#where-job-bodies-actually-live-the-tiered-envelope) for the full picture.

| Payload size | Where it lives | What to watch |
|---|---|---|
| **≤ 1 KiB** | Inline raw JSON in the staged value | nothing — the cheap path |
| **1 KiB to ≤ 4 KiB** | Inline gzip+base64 (if smaller than raw) | nothing |
| **4 KiB to ≤ 256 KiB** | Standalone Redis key, ref in envelope. Reclaimed on job completion via the holder set, 3-day TTL backstop. | Redis memory growth in the `{queue}:gq:blob:*` keyspace — usually a runaway-fan-out signal |
| **> 256 KiB, ≤ 50 MiB** | Object store (S3 / file / azure-blob — projectId-scoped to the BYOC bucket) | Object-store request rate; bucket lifecycle policy as backstop for missed reclaims |
| **> 50 MiB** | Rejected at encode — `PayloadTooLargeError` | Hit by a product bug or a runaway loop — fix upstream rather than raise the cap |

**Content-addressed sharing** means the storage cost of a payload is paid **once** per `(projectId, content-hash)`, regardless of how many jobs reference it. A 30-reactor fan-out of the same event stages 30 envelopes — 30 hold tokens on the same holder set, one stored blob. When all 30 complete (or all retry to the same content), the blob is reclaimed atomically.

### Configuring writes

GQ2 (content-addressed) writes are gated behind `GROUP_QUEUE_ENVELOPE_WRITES_ENABLED=true`. With the flag unset, the queue writes legacy bare-JSON envelopes (GQ1 path) — the GQ2 reader handles both, so rollout is one-way: enable the flag once every consumer in the fleet reads GQ2 envelopes.

---

## Caveats

- **Queue name must be hash-tagged.** A non-`{...}` name passes the type checker but fails at runtime in Redis Cluster mode (CROSSSLOT). The `hasRedisHashTag` guard catches this on construction.
- **The `__*` namespace is reserved.** User payloads must not carry `__custom` or similar — they'll be rejected at `send`-time. The three caller-set routing fields (`__pipelineName`, `__jobType`, `__jobName`) are the only `__*` keys the queue accepts from outside; everything else is queue-internal machinery.
- **Holders TTL is a backstop, not the primary reclaim.** The happy path reclaims a blob the moment its last holder drops, atomically inside the release Lua. The 3-day TTL is for genuinely-orphaned blobs (mid-completion crash leaves a holder leaked). Don't tune the TTL down without understanding which path is doing the work in your traffic.
- **Cluster mode requires same-slot keys.** Holder Lua touches multiple keys; the hash tag is what makes that safe. If you add new keys to the staging layer, they MUST share the queue's hash tag.
- **Memory queue is for tests / dev.** It processes jobs in-process with no Lua, no Redis, no tiered storage. Don't reach for it in production code paths; it exists so unit tests don't need a docker-compose dependency.
- **Holders are per-queue, blobs are per-tenant.** Two queues that stage byte-identical content for the same project will reference the SAME stored blob (at the s3 tier), each with their own holder set. The blob is reclaimed only when both holder sets are empty.
- **An assertion error in `send` doesn't roll back upstream work.** The reserved-namespace check throws synchronously; callers must treat `send`/`sendBatch` as fallible from this PR forward (it always was, but rejected for fewer reasons).

---

## Testing

### Unit tests

Use the in-memory queue (`queues/memory.ts`) for tests that don't need Redis at all:

```typescript
import { EventSourcedQueueProcessorMemory } from "~/server/event-sourcing/queues/memory";
```

For unit tests that exercise the GroupQueue encoder/decoder (without spinning up Redis), use the shared in-memory test doubles:

```typescript
import {
  InMemoryJobBlobStore,
  InMemoryObjectStore,
} from "~/server/event-sourcing/queues/groupQueue/__tests__/blobTestDoubles";
```

### Integration tests

Require a Redis testcontainer. The existing suites are good templates:

- [`blobHolders.integration.test.ts`](./__tests__/blobHolders.integration.test.ts) — pure holder-set Lua semantics
- [`envelopeBlobLifecycle.integration.test.ts`](./__tests__/envelopeBlobLifecycle.integration.test.ts) — encode/decode + acquire/release/transfer + cross-tenant guards
- [`groupQueue.gq2.integration.test.ts`](./__tests__/groupQueue.gq2.integration.test.ts) — end-to-end through the GroupQueueProcessor (offload → dispatch → reclaim)
- [`groupQueue.integration.test.ts`](./__tests__/groupQueue.integration.test.ts) — broader staging + retries + dedup

Each suite uses a hash-tagged namespace prefix (`{test/holders}`, `{test/lifecycle/...}`) and scopes its `afterEach` cleanup to that prefix — no `redis.flushall()`, so suites can run in parallel against the same Redis without clobbering each other.

---

## Observability

The queue emits a full set of Prometheus metrics (see [`metrics.ts`](./metrics.ts)):

- Throughput: `gqJobsStagedTotal`, `gqJobsDispatchedTotal`, `gqJobsCompletedTotal`
- Failures: `gqJobsRetriedTotal`, `gqJobsExhaustedTotal`, `gqJobsNonRetryableTotal`
- Latency: `gqJobDelayMilliseconds` (stage → dispatch), `gqJobDurationMilliseconds` (process)
- Dedup + delay: `gqJobsDedupedTotal`, `gqJobsDelayedTotal`
- Retry distribution: `gqRetryAttempt`, `gqRetryBackoffMilliseconds`
- Group state: `gqGroupsBlockedTotal`

OpenTelemetry spans wrap dispatch and processing. `__context` carries OTel trace context through the envelope so a span dispatched on the web tier continues on the worker.

For ad-hoc inspection during development, the `bullboard` service in the dev stack (`make quickstart full-local`) shows queue state via Redis directly — it doesn't depend on BullMQ.

---

## Common Pitfalls

1. **Non-hash-tagged queue name in Cluster mode.** Use `{queueName}` syntax. The `hasRedisHashTag` guard catches this on construction; if you somehow bypass it, the Lua scripts will CROSSSLOT.
2. **Sending payloads with `__custom` keys.** The reserved-namespace check rejects these to prevent silent content-hash collisions. Pre-set `__pipelineName / __jobType / __jobName` if needed (the queue allows those three as caller-controlled routing); use a different name for anything else.
3. **Forgetting `consumerEnabled: false` on the web tier.** Web pods will start dispatching jobs that should run on the worker tier — different memory profile, different autoscaler.
4. **Sending payloads > 50 MiB.** Hit `PayloadTooLargeError`. The fix is to push the data to its own store and send a reference, not to raise the cap.
5. **Relying on cross-aggregate ordering.** Different aggregates parallelise; the queue guarantees FIFO only within a group. If you need global ordering, you need a different design.
6. **Disabling the GQ2 write flag, then re-enabling.** Mid-rollout, pods write a mix of GQ1 and GQ2 envelopes — the reader handles both, but the dispatcher's content-addressed dedup only fires for GQ2 envelopes. Roll forward once.

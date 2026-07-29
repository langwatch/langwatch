# GroupQueue — Architecture

A high-level technical overview of the in-house GroupQueue: how per-aggregate FIFO is achieved on Redis without BullMQ, how the dispatcher loop turns Redis signals into local concurrency, how the envelope tiers staged values across inline / Redis-blob / object-store storage based on size, and how content-addressed dedup collapses a fan-out's identical bodies to a single stored blob.

For day-to-day usage (when to use it, basic examples, configuration, caveats), see [README.md](./README.md).

---

## Why a Custom Queue

BullMQ gives you "process this job, eventually." That isn't enough for an event-sourcing fold projection, which needs:

1. **Per-aggregate FIFO.** Event N for trace `abc` must be fully processed before event N+1 for `abc` even starts — otherwise the fold sees out-of-order applies and the persisted state diverges from the event log.
2. **Cross-aggregate parallelism.** Trace `abc` and trace `xyz` are independent — blocking one on the other wastes the fleet.
3. **Fair scheduling.** A noisy tenant must not starve a quiet one; a backed-up group must not starve fresher work.
4. **Predictable retries.** A transient failure should re-stage with backoff in front of the same group (preserving FIFO), not stall the whole queue.

GroupQueue is built on Redis primitives (lists, hashes, sets, sorted sets) coordinated by Lua scripts that hold the staging invariants. The result: per-group FIFO, cross-group parallelism, and the same horizontal-scale story as any other Redis worker fleet.

---

## The Staging Layer

Every job sent to a GroupQueue lands first in the **staging layer** — a set of co-slot-hashed Redis keys that hold the queue's invariants. The staging primitives are pure Lua scripts ([`scripts.ts`](./scripts.ts)); everything else (dispatcher loop, fastq processor, retry classifier) is TypeScript that calls into them.

| Key | Type | Role |
|---|---|---|
| `{queue}:groups:active` | sorted set | groups with pending work, scored by next-eligible timestamp |
| `{queue}:group:{groupId}:jobs` | sorted set | per-group staged-job IDs scored by ready time — FIFO in practice, with retries scored into the future (ZADD on stage, ZRANGEBYSCORE + ZREM on dispatch) |
| `{queue}:group:{groupId}:data` | hash | staged-job ID → envelope value (the body) |
| `{queue}:group:{groupId}:blocked` | string | non-empty marker that this group is paused (set by retries, cleared on resume) |
| `{queue}:signals` | list | wake-up signals consumed by `BRPOP` (one entry per stage) |
| `{queue}:active:{groupId}` | string | TTL'd marker — group is currently being processed somewhere; crash-recovery safety net |
| `{queue}:dedup:{dedupId}` | string | dedup window — staged-job ID currently occupying this dedup slot |

The `{queue}` prefix is a Redis Cluster hash tag (`{...}`), so every key for a given queue lands in the same cluster slot. This is what lets the Lua scripts touch multiple keys atomically — a CROSSSLOT eval is a runtime error, not a thing that ever happens.

---

## Lifecycle of a Single Job

```
producer.send(payload)
  │
  ▼  STAGE_LUA: ZADD job id to `:jobs` (scored by ready time), HSET envelope,
  │             ZADD group → active, dedup write, LPUSH a signal
  │
  ▼  signals list  ──BRPOP──▶  dispatcher loop  (idle workers wake up here)
  │
  ▼  DISPATCH_BATCH_LUA: pick next eligible groups (weighted RR), take its next
  │                due job from `:jobs` (ZRANGEBYSCORE + ZREM),
  │                read envelope, mark group active with TTL
  │
  ▼  fastq processing slot (local node concurrency)
  │
  ▼  decode envelope (re-merge header machinery onto body, fetch offloaded blob)
  │
  ▼  user's `process(payload)` handler
  │
  ▼  COMPLETE_LUA: HDEL the envelope, drop the active marker, ZREM if group empty
  │
  ▼  release this holder's blob lease (shared data is reclaimed lazily)
```

A failure anywhere in this chain takes one of three paths:

- **Retryable** → `RESTAGE_AND_BLOCK_LUA` puts the job back at the head of its group with a backoff score; the group is briefly blocked so the same job comes out next.
- **Non-retryable** → drop to the fail-safe (complete the slot; recover via event replay for fold/map only — a reactor on the path is named + preserved, not recovered; see ADR-046).
- **Transient blob-store error** → re-stage the SAME envelope (same hold token) so the body stays referenced through the retry.

---

## Cross-Aggregate Parallelism + Fair Scheduling

The dispatcher pulls one signal at a time off `BRPOP` and then runs `DISPATCH_BATCH_LUA`, which:

1. Picks the next eligible group from the `active` sorted set (`ZRANGEBYSCORE 0 now`).
2. Weights groups by `sqrt(pendingCount)` so a backed-up group gets more turns without starving fresher work.
3. Per dispatch call, drains up to `MAX_BATCH_SIZE` jobs across groups, bounding script execution time.

Each dispatched job becomes a `fastq` task on the local node, capped at `GLOBAL_QUEUE_CONCURRENCY` (default 100). `fastq` is just a local concurrency limiter — multiple worker nodes share the same Redis-side staging, so horizontal scale is `nodes × per-node-concurrency`.

Tenant rate tracking ([`TenantRateTracker`](../../../observability/tenantRateTracker.ts)) records throughput per tenant; the score formula keeps a high-throughput tenant from monopolizing the dispatcher.

---

## Where Job Bodies Actually Live: The Tiered Envelope

A job's payload can range from "a 200-byte status update" to "a 30 MiB trace dump." Inlining all of it in the staged value works for the small case but bloats the Redis-side hash, blows past the Lua script's reply-size budget, and replicates the same bytes 30× when an event fans out to 30 reactors. So the envelope **tiers** the body across four progressively-more-durable storage targets, picked at encode time based on the body's serialized size.

```
serialized payload size
        │
        ├──── ≤ 1 KiB ─────────────────▶ INLINE (raw JSON)
        │                                  envelope = "GQ2|<hLen>|<hJson><json>"
        │
        ├──── 1 KiB to ≤ 4 KiB ────────▶ INLINE (gzip+base64 if smaller)
        │                                  envelope = "GQ2|<hLen>|<hJson><gz-b64>"
        │
        ├──── 4 KiB to ≤ 256 KiB ──────▶ REDIS-TIER BLOB (standalone Redis key)
        │                                  envelope = "GQ2|<hLen>|<hJson>"  (no body)
        │                                  blob key  = "{queue}:gq:blob:{projectId}/{sha256}"
        │
        └──── > 256 KiB, ≤ 50 MiB ─────▶ S3-TIER BLOB (stored-objects bucket)
                                           envelope = "GQ2|<hLen>|<hJson>"  (no body)
                                           object key = "{projectId}/{sha256}" in the project's bucket
```

`> 50 MiB` is rejected at encode time (`PayloadTooLargeError`) — large enough to be a clear product bug, small enough to bound worst-case worker memory at `MAX_BLOB_BYTES × concurrency`.

### Why these tiers?

- **Inline raw (≤ 1 KiB)** — gzip+base64 of sub-kilobyte JSON is usually *larger* than the input. Skip compression entirely.
- **Inline gzip (1–4 KiB)** — gzip wins for most real payloads in this range; the encoder verifies (`gzip+base64 < raw`) and falls back to raw if not. The inline ceiling (`INLINE_CEILING_BYTES = 4 KiB`) is set low so ordinary fan-out events cross into the dedup tier rather than inlining N× across reactors. Tighter than the GQ1 32 KiB threshold (`BLOB_OFFLOAD_THRESHOLD_BYTES`), which only offloaded for the very-large case.
- **Redis blob (4–256 KiB)** — bigger than we want repeated in the staged value (every fan-out copy would replicate), but small enough that round-trip latency through a standalone Redis key is fine. It has a 4-day backstop refreshed on every read (`GETEX`) and is reclaimed lazily by Redis expiry.
- **S3 / object-store (> 256 KiB)** — large bodies are the worst-case for Redis: memory pressure, replication lag, eviction risk. Push them to the durable object store the rest of the platform already runs on (`StorageRegistry`, projectId-scoped so each tenant's BYOC bucket is honored). Application releases never delete shared objects; the configured durable-store lifecycle sweep is the reclaim path.

All thresholds live in [`jobEnvelope.ts`](./jobEnvelope.ts) and [`tieredBlobStore.ts`](./tieredBlobStore.ts). The 4 KiB inline ceiling and 256 KiB S3 threshold are conservative — tighten them under load if metrics show too much inline bloat or too many Redis-tier blobs.

### Content-addressed sharing

A Redis-tier or S3-tier blob is keyed by `{projectId}/{sha256(payload-bytes)}` — content-addressed, tenant-namespaced. The two consequences:

- **Identical bytes → one stored blob.** A 30-reactor fan-out of the same event stages 30 envelopes, each carrying a distinct lease-holder identity, but the underlying blob is a single stored copy. PUTs are idempotent — racing or retrying just overwrites the same key with the same content.
- **Tenant isolation.** Two tenants with byte-identical user payloads still get distinct blobs (different `projectId` prefix). A project purge is a delete-by-prefix.

The hash is taken over the **raw** payload bytes, not the gzipped output, so the dedup key doesn't depend on gzip determinism (zlib version / compression level).

### Routing-exclusion: keeping the hash stable across reactors

The same event fanned out to reactor A (`__jobName: "rollup-by-day"`) and reactor B (`__jobName: "rollup-by-hour"`) would naively hash to different blobs because the per-reactor routing fields perturb the body bytes. To prevent this, the GQ2 encoder splits `jobData` into:

- **Body** — every key not starting with `__`. This is what the hash is computed over.
- **Header machinery** — every `__*` key (routing names, attempt counter, async context, staged-job id, dispatch score). These live in `header.m` and `header.p/t/n`; the routing trio is also surfaced as a read-fast-path for the dispatcher Lua and the ops dashboard.

On decode, the machinery is re-merged onto the parsed body so downstream code sees the original `jobData` shape. The strip is allowlist-free: any future `__*` field is automatically lifted to the header, so a maintainer can't accidentally regress dedup. The public `send`/`sendBatch` reject any `__*` key in user payload (except the 3 caller-set routing fields) — the namespace contract is enforced at the boundary.

See ADR-029 (content-addressed store) and ADR-030 (hardening) for the design.

---

## Per-Holder Renewable Leases

Reference counting made correctness depend on every completion releasing its token. A worker crash between processing and release leaked the holder indefinitely, while eager last-release deletion could race a live sibling or a rolling-deploy peer.

GroupQueue instead uses a **per-blob Redis sorted set**. Each staged occupancy gets a stable holder identity; its score is an absolute 3-day lease deadline calculated from Redis server time. Initial, batch, retry, and blocked-restage scripts publish the staged value and its lease in the same Redis transaction. Decode, the active-job heartbeat, and transfer renew the deadline; a coalesced batch heartbeats every participating envelope. Every lease operation first prunes expired members. A Redis-tier renewal also slides the blob's 4-day backstop in the same eval, leaving a full day for lazy reclaim and ensuring a live lease cannot outlast its data:

```lua
local now = redis.call("TIME")
local deadlineMs = nowMs(now) + leaseTtlMs
redis.call("ZREMRANGEBYSCORE", leaseKey, "-inf", nowMs(now))
redis.call("ZADD", leaseKey, deadlineMs, holderId)
```

Key properties:

- **Crash-bounded.** A crashed holder stops renewing and disappears after the lease window; no explicit release is required for convergence.
- **Live siblings remain protected.** Every holder has its own deadline, so pruning a crashed sibling cannot remove a live job's renewed lease.
- **Duplicate take/release is idempotent.** `ZADD` updates one member and `ZREM` of a missing member is harmless.
- **No eager deletion.** Release and transfer mutate lease membership and expiry, never blob contents. Redis TTL reclaims Redis-tier bytes. The durable tier relies on the deployment's bucket lifecycle/project-purge policy; adding lease-aware, storage-specific durable GC is separate from this change's explicitly unchanged S3 tiering behaviour.
- **Bounded retention after the last release.** Retiring the last lease shortens the Redis-tier blob's expiry from the 4-day backstop to `BLOB_RELEASE_GRACE_TTL_SECONDS` (1 hour). Without it the backstop is the only Redis-tier reclaim path, so nothing drains a retired blob before it ages out and retention runs the full four days deep — a ceiling that was never sized against the instance it has to fit in, and that production exceeded (2026-07-21). Shortening a deadline is not deletion — the bytes stay readable and any later take re-arms the full backstop — so a producer that wrote content-addressed bytes before the release and stages after it still finds them. Withheld while any lease is live, or while the rolling-deploy holder set carries a member beyond the migration sentinel. Counted by `gq_blob_release_grace_total`.
- **Cluster-safe.** Blob, lease, migration-guard, and queue keys share the queue's Redis hash tag.

A retry or dedup-squash uses `TRANSFER_LUA` to take/renew the new lease and remove the old member atomically. The blob is never deleted on either the same-content or changed-content path; a changed-content transfer that retires the displaced blob's last lease puts it on the grace window.

`gqGraceExpireIfUnleased` ([`blobGraceLua.ts`](./blobGraceLua.ts)) is the one definition of that decision, shared verbatim by the standalone release/transfer evals and by the dedup-squash release inlined into `STAGE_LUA`, so a release path cannot drift into leaving the full backstop where the others would not.

During a rolling deploy, lease operations also write a TTL-bound sentinel into the previous release's holder set. Old release code therefore cannot observe an empty set and eagerly delete a blob written or renewed by new code. Existing ref-count-era blobs remain readable; the first new-code decode renews a lease, while finite Redis TTLs and the durable-store lifecycle policy eventually reclaim untouched legacy data.

---

## Tenant Isolation

Every blob ref carries the tenant's `projectId` (branded `TenantId` end-to-end). On decode, the lifecycle asserts `lease.ref.projectId === projectIdFor(groupId)` BEFORE fetching — a mis-routed or tampered envelope can't read another tenant's blob. The same guard runs on `release` and `transfer`: a foreign-tenant lease is left to expire rather than dropped via the wrong tenant's cleanup path.

The s3 object URI is re-minted server-side from `(projectId, hash)` on every read, never trusted from the envelope. Even a tampered envelope can't redirect a fetch across tenants.

Error logs from the blob lifecycle run through `redactStorageUrisInText` so an object-store SDK error quoting `s3://bucket/...` doesn't leak a BYOC bucket name into a shared log sink.

---

## Memory Queue: The Dev/Test Fallback

When Redis isn't available (local development without `docker-compose`, fast unit tests), the framework drops back to [`queues/memory.ts`](../memory.ts) — an in-memory queue that processes jobs asynchronously with simple concurrency control. **Different code path entirely**, not a tier of GroupQueue: no Redis, no staging Lua, no tiered storage. Useful for tests and single-instance development; not for production. The tier picker doesn't apply there because everything is held in process memory.

---

## Retries and Backoff

When a `process()` handler throws, the queue:

1. **Classifies** the error via `categorizeError`:
   - `Retryable` → re-stage with exponential backoff
   - `NonRetryable` → drop to the fail-safe; the slot is completed and the work recovers via event replay for fold/map only — replay never invokes reactors, so a reactor job is named + dead-lettered, not recovered (ADR-046)
   - `Transient` (blob-store specific) → re-stage the SAME envelope (same lease-holder identity, no re-encode)
2. **Computes backoff** via `getBackoffMs(attempt)` (exponential, capped at 10 min — no jitter, so simultaneous failures retry in lockstep).
3. **Re-encodes** the payload with `__attempt: N+1` and atomically transfers the lease from the old envelope to the new one.
4. **Re-stages** at the head of the group with a future score (the group is briefly blocked so the retry is the next one dispatched).
5. **Exhausts** after `JOB_RETRY_CONFIG.maxAttempts` and increments `gqJobsExhaustedTotal`; the slot is completed.

Because routing-exclusion keeps the content hash stable across retries (the body is unchanged; `__attempt` is in the header), the atomic transfer is a same-set `ZADD + ZREM` — the replacement is leased before the retired identity is removed.

---

## Deduplication

Three modes, configured per-job or per-queue:

- **None** (default) — every send stages a new job.
- **`"aggregate"`** — dedup ID is `${tenantId}:${aggregateType}:${aggregateId}`; only the latest event per aggregate is processed within the dedup window (default 200 ms).
- **Custom `DeduplicationConfig`** — caller-supplied `makeId` + `ttlMs`, with `extend` (reset TTL on each new send) and `replace` (overwrite the staged value) flags.

Dedup is implemented inside `STAGE_LUA`: a write to `{queue}:dedup:{dedupId}` with the staged-job ID; subsequent sends within the TTL either coalesce, replace, or extend. The orphaned staged value (when `replace: true`) has its lease transferred atomically to the new envelope — see "Per-Holder Renewable Leases" above for why this matters.

---

## Coalescing / Batch Processing

Pipelines that opt in (`processBatch` + `coalesceMaxBatch` in the queue definition) can drain multiple jobs from the same group in one dispatch, hand them to the user as an array, and complete them as a batch. The drain is bounded by `coalesceMaxBatch(payload)` — a per-payload knob since some payload shapes can usefully coalesce up to N, others only 1.

Coalesced batches go through the same envelope decoder and the same lifecycle: every staged value's lease is taken at stage, renewed together throughout a long-running handler, released on batch completion, or retry-transferred to the re-encoded retry value.

---

## Pause / Resume

The `{queue}:group:{groupId}:blocked` marker is set by:

- A retry (`RESTAGE_AND_BLOCK_LUA`) — briefly blocks the group so the retry is next out.
- An explicit pause from the queue-pausing pipeline (see [`specs/queue-pausing/queue-pausing.feature`](../../../../../../specs/queue-pausing/queue-pausing.feature)).

`DISPATCH_BATCH_LUA` skips blocked groups when picking the next eligible group; the active sorted set is unchanged but the group is invisible to the dispatcher until unblocked. Unblock is just deleting the marker.

The active key (`{queue}:active:{groupId}`) is a separate safety net: a TTL'd marker that says "this group is being processed by someone right now." On crash, the TTL expires (default 5 min) and the group becomes dispatchable again — a stuck job is recoverable without manual intervention.

---

## Failure Handling: Fail-Safe Paths

The queue is built so a transient infrastructure failure never drops a job, and a permanent failure never silently corrupts state:

- **Missing blob** (offloaded body genuinely gone — TTL backstop kicked in, or a manual purge) → `decodeJobEnvelope` throws a `DecodeFailureError` with reason `missing_blob`; the dispatcher catches it, logs it, and completes the slot (`dropStagedJob` with `bodyIsGone`, releasing the stale lease). The work recovers via event replay for fold/map projections only — replay never invokes reactors (ADR-046), so a missing-blob reactor drop is named in the drop log (addressable to its event), not recovered.
- **Transient blob-store error** (network blip, 5xx) → classified `TransientBlobStoreError`, the job is re-staged with the SAME envelope (no re-encode, no lease identity churn). Distinguished from `Missing` so a transient store outage can't mass-drop every in-flight offloaded job.
- **Decode tenant mismatch** → refuse to fetch, log tenant-attributed, drop to fail-safe.
- **Oversized value** (staged value or decompressed blob exceeds `MAX_BLOB_BYTES` at decode) → parked unparsed via the poison guard below.
- **Lease Lua failure** → log + rely on the TTL backstop.

The fail-safe always prefers "complete the slot and let replay handle it" over "stall the queue" — event sourcing's append-only event log is the durable source of truth.

### Poison guard (claim-side)

Job-level retry accounting assumes the process survives the job. A payload that seizes the event loop breaks that assumption: the liveness probe kills the process before any catch/retry runs, the group's job is redelivered on the next boot, and the crash loop repeats fleet-wide. The guard closes that gap at claim time (`specs/event-sourcing/poison-group-park-guard.feature`):

- **Claim strikes** - `processWithRetries` records a per-group strike in Redis (`{queue}:gq:group:{groupId}:strikes`, 1h TTL) before decoding and clears it in a `finally` on every surviving path. Only a job that kills the process leaves a strike behind. Once strikes exceed `LANGWATCH_GQ_POISON_STRIKE_THRESHOLD` (default 3, `0` disables), the claim parks the group into the blocked set with a stored explanation instead of running the killer again.
- **Decode cap** - staged values whose serialized (or decompressed) size exceeds `MAX_BLOB_BYTES` park the group unparsed. These are legacy bare-JSON values or tampered envelopes that predate or bypass the encode cap; dropping them to replay would just re-materialize the same value.
- **Recovery** - parked groups appear in the ops blocked summary with the stored error. Every operator exit resets the strike count: unblock, drain, and move-to-DLQ all clear the strikes key, so a group re-created under the same id gets a fresh run instead of insta-parking on stale strikes within the 1h TTL. Draining discards the staged copies (event replay can rebuild).

---

## Observability

| Metric | Purpose |
|---|---|
| `gqJobsStagedTotal` / `gqJobsDispatchedTotal` / `gqJobsCompletedTotal` | end-to-end throughput |
| `gqJobsRetriedTotal` / `gqJobsExhaustedTotal` / `gqJobsNonRetryableTotal` | failure characterisation |
| `gqJobsDedupedTotal` / `gqJobsDelayedTotal` | dedup + delay activity |
| `gqGroupsBlockedTotal` | how often a group blocks (retries / pauses) |
| `gqGroupsPoisonParkedTotal` | claim-side poison guard parks (`reason`: claim_strikes, oversized_payload) |
| `gqJobDelayMilliseconds` / `gqJobDurationMilliseconds` | latency + processing time |
| `gqRetryAttempt` / `gqRetryBackoffMilliseconds` | retry distribution |

OpenTelemetry spans wrap dispatch + processing; `__context` round-trips OTel trace context through the envelope so a span dispatched on web continues on the worker.

---

## Composition Root

GroupQueue dependencies are explicit constructor injections — no env-coupling. The composition root ([`eventSourcing.ts`](../../eventSourcing.ts)) supplies:

- The Redis connection (shared with the rest of the platform).
- `objectStoreFor(projectId)` → `StorageRegistry` (per-tenant BYOC bucket resolution).
- `resolveStorageDestination(projectId)` → `ProjectStorageDestination` (BYOC or global).
- `featureFlagService` (kill-switch support).

This keeps the queue testable in isolation: integration tests pass an in-memory `ObjectStore` + a stub destination resolver and exercise the full Lua + lease lifecycle against a testcontainers Redis.

---

## Quick File Map

| Concern | File |
|---|---|
| Main processor + send/dispatch wiring | [`groupQueue.ts`](./groupQueue.ts) |
| Dispatcher loop (BRPOP + fastq) | [`dispatcher.ts`](./dispatcher.ts) |
| Staging Lua scripts | [`scripts.ts`](./scripts.ts) |
| Envelope encode / decode (GQ1 + GQ2) | [`jobEnvelope.ts`](./jobEnvelope.ts) |
| Content-addressed tiered store | [`tieredBlobStore.ts`](./tieredBlobStore.ts) |
| Per-holder renewable lease Lua | [`blobLeases.ts`](./blobLeases.ts) |
| Shared last-release grace-window Lua | [`blobGraceLua.ts`](./blobGraceLua.ts) |
| Lifecycle collaborator (encode/decode + take/release/transfer) | [`envelopeBlobLifecycle.ts`](./envelopeBlobLifecycle.ts) |
| Shared key layout (blob + lease) | [`blobKeys.ts`](./blobKeys.ts) |
| Cluster hash-tag guard | [`redisHashTag.ts`](./redisHashTag.ts) |
| Constants (TTLs, size cap) | [`blobConstants.ts`](./blobConstants.ts) |
| GQ1 (legacy) randomUUID blob store | [`redisJobBlobStore.ts`](./redisJobBlobStore.ts) |
| Metrics definitions | [`metrics.ts`](./metrics.ts) |
| Periodic metrics collector | [`metricsCollector.ts`](./metricsCollector.ts) |

## Related ADRs

- [ADR-026](../../../../../../dev/docs/adr/026-groupqueue-payload-envelope.md) — the GQ1 envelope format
- [ADR-029](../../../../../../dev/docs/adr/029-groupqueue-content-addressed-payload-store.md) — content-addressed tiered store (GQ2)
- [ADR-030](../../../../../../dev/docs/adr/030-groupqueue-blob-handling-hardening.md) — hardening for the GQ2 store path

## Related Specs

- [`payload-envelope.feature`](../../../../../../specs/event-sourcing/payload-envelope.feature) — GQ1 envelope behaviour
- [`payload-store-content-addressed.feature`](../../../../../../specs/event-sourcing/payload-store-content-addressed.feature) — GQ2 content-addressed store behaviour
- [`payload-store-blob-hardening.feature`](../../../../../../specs/event-sourcing/payload-store-blob-hardening.feature) — GQ2 hardening behaviour

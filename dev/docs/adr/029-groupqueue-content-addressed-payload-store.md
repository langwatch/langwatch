# ADR-029: GroupQueue content-addressed tiered payload store — flat jobs, fan-out dedup, holder-set reclaim

**Date:** 2026-06-20

**Status:** Proposed

**Extends / supersedes in part:** [ADR-026](./026-groupqueue-payload-envelope.md) (GroupQueue payload envelope). The versioned-envelope + header-only routing decision stands. This ADR supersedes ADR-026's §"Blob lifecycle" — random blob ids, best-effort delete, and the 7-day pure-backstop TTL — for offloaded bodies.

**Reuses:** the `stored-objects` object store — `StorageDriver` / `StorageRegistry` / content-addressed URI minting / `resolveProjectStorageDestination` (`src/server/stored-objects/`, the codebase's single pluggable object-store abstraction; behavioural contract in [externalize-event-byte-content.feature](../../../specs/features/scenarios/externalize-event-byte-content.feature)). The S3/file tier delegates to it. This is *not* [ADR-022](./022-event-log-source-of-truth.md)'s `BlobStore`, which is event_log-centric (it reads full content back out of ClickHouse) and is not a general object store; that one is not reused here.

**Not to be confused with:** [ADR-024](./024-cold-path-tiered-storage.md) (cold-path tiered storage). ADR-024 tiers *ClickHouse* parts hot→cold across SSD and S3 volumes. This ADR tiers *GroupQueue staged-job payloads* inline→Redis→S3. Different subsystem; overlapping word.

**Relates to:** [ADR-007](./007-event-sourcing-architecture.md) (event sourcing), `specs/queue-pausing/queue-pausing.feature`, the GroupQueue dedup-id squash (`specs/traces/record-span-gq-dedup.feature`, `specs/event-sourcing/deduplication-strategy.feature`).

## Context

A single event fans out to many staged jobs. The projection router dispatches one trace event to a fold projection, several map projections, and a chain of reactors — on the order of a dozen or more jobs for one trace event. Each of those jobs today carries its **own inline copy of the same large shared payload** (the event, and for reactors the fold state). The fan-out factor multiplies the payload's Redis footprint, and it does so precisely during ingestion bursts — the moment the queue is already under memory pressure.

The duplication is uncured by today's offload, for two reasons:

1. **Most fan-out payloads never offload.** ADR-026 offloads only bodies above 32 KiB; the leaned projection events (IO attributes capped at a 64 KiB preview by ADR-022, most attributes far smaller) frequently sit below that line and inline N times into the per-group data hash.
2. **Even when they offload, they don't dedup.** ADR-026's blob id is a `randomUUID()` (`jobEnvelope.ts`), so N byte-identical payloads land under N distinct keys. There is no content identity, so there is nothing to collapse.

Two further forces motivate a rewrite rather than a patch:

- **Offload is split by provenance, and there are three of them.** ADR-026's Redis blob (queue jobs), ADR-022's edge S3 spool (oversized commands), and the `stored-objects` object store (externalized media) are three separate systems with separate thresholds, key shapes, and lifecycles. Where a payload's bulk lives depends on *which subsystem touched it*, not on *how big it is*. We want one answer, keyed on size alone, and we want the durable tier to reuse the one object-store abstraction the codebase already has.
- **Cleanup has to survive a weekend.** A blob whose job is stuck — a retry-backoff chain, a paused pipeline — over a Friday→Monday must still exist on Monday. That pushes any safety-net TTL to **≥3 days**. But a 3-day TTL as the *primary* reclaim means three days of dead payloads accumulating at ingestion volume — untenable. The happy path must reclaim eagerly; only the genuinely-stuck path may ride the long backstop. Neither a pure long TTL (accumulates) nor a pure reference count (Redis has no GC; a single missed decrement leaks forever) satisfies both ends.

## Decision

Four parts: a content-addressed three-tier store, flat jobs, holder-set reclaim with a TTL backstop, and tenant-namespaced keys. It lives behind the GroupQueue serialization boundary in `src/server/event-sourcing/queues/groupQueue/` plus the fan-out producer in `src/server/event-sourcing/projections/`, and it reuses `src/server/stored-objects/` for the durable tier.

### 1. One content-addressed, three-tier payload store

The bulk of a staged job — its shared payload component(s) — is stored by **content hash**, in one of three tiers chosen by serialized size:

| Tier | Size | Backend | Key |
|---|---|---|---|
| `inline` | ≤ 4 KiB | the envelope body itself (raw, or gzip when it wins) | — |
| `redis` | 4 KiB – 256 KiB | standalone Redis key, gzip binary (the queue's own `RedisJobBlobStore`) | `{queue}:gq:blob:{projectId}/<hash>` |
| `s3` | > 256 KiB | the reused `stored-objects` `StorageRegistry` (s3:// or file://) | `s3://{bucket}/{projectId}/<hash>` |

`<hash>` is SHA-256 of the canonical component bytes, truncated to 128 bits, base64url (~22 chars; collision probability negligible). Identical bytes ⇒ identical key ⇒ **one** stored copy, however many jobs reference it. PUTs are idempotent — same content, same key — so a retried or racing stage is free and crash-safe.

The 256 KiB S3 boundary matches ADR-022's existing `COMMAND_INLINE_THRESHOLD`. The 4 KiB inline ceiling drops ADR-026's 32 KiB so that ordinary fan-out events cross into the content-addressed `redis` tier and dedup, instead of inlining N×. All three thresholds are env-tunable. Only the durable (`s3`/`file`) tier goes through `stored-objects`; the hot `redis` tier stays queue-local because it carries a TTL + holder-set lifecycle that the object store has no notion of — "one offload mechanism" means one *object store* for the durable tier, not one interface over both Redis and S3.

### 2. Flat jobs

A staged job no longer embeds the shared payload. The fan-out producer (projection router / reactor dispatch) hoists each shared component — the **event**, and where applicable the **fold state** — out of the N per-consumer payloads, stores it once through the tiered store, and stages N flat jobs that carry only:

- the per-consumer wrapper and the routing metadata the dispatch Lua already reads from the header (`__pipelineName` / `__jobType` / `__jobName` / `__context` / `__attempt`), and
- tier-tagged content refs (`eventRef`, optionally `foldStateRef`) in place of the inline objects.

A thin **resolve-adapter** wraps each handler and reconstitutes the refs before the handler runs, so **handlers are unchanged** — they still receive `{ event, foldState }`. The hoist happens at the **producer**, not the per-job encoder, for two reasons the real payload shapes force:

- **The shapes are heterogeneous.** A reactor job is `{ event, foldState }` (the event is a nested field — `projectionRouter.ts:144`); a projection job sends the event *spread* (the event *is* the payload) with a per-projection `__jobName`. So whole-payload or top-level-field hashing dedups almost nothing across the fan-out — the only bytes identical across all consumers are the event (and the fold state), and the producer alone is positioned to lift them out *before* the shapes diverge.
- **Serialize once, not N times.** Hoisting at the producer serializes, hashes, and stores the shared component **once** per fan-out and hands N jobs a ref. Hoisting in the per-job encoder would re-serialize and re-`PUT` it N times — idempotent on storage, but paying the CPU and the Redis network burst N times, and the burst is exactly what hurts under load. The producer hoist is the only one that relieves the burst, not just the at-rest footprint.

The reshape is invisible above the serialization boundary, exactly as ADR-026's envelope was. The load-bearing subtlety: the dedup must key on the shared **component**, lifted at the fan-out point — not the whole job body.

### 3. Holder-set reclaim + TTL backstop

Because a content-addressed blob is shared, ADR-026's "delete on complete" is unsafe: one job's completion would yank a blob its siblings still reference. References are tracked with a **holder set** per blob and reclaimed eagerly when it empties, with a long TTL as the orphan backstop.

- **Holder set** `{queue}:gq:blobholders:{projectId}/<hash>` — members are staged-slot ids (the `stagedJobId`s of `record-span-gq-dedup.feature`). A staged job referencing blob H adds its slot id; every *terminal retirement* of that slot removes it. Crucially, **the holder ops are TS-orchestrated at the queue's existing reclaim seams — not surgery inside the big lifecycle Lua.** At dispatch the queue `HDEL`s the job value out of the group hash and carries it to the worker in memory (`scripts.ts:787`, `groupQueue.ts:499`), so by `complete` time there is nothing in the hash to be atomic with — the value, and its ref, live on the worker. The seams already exist: `deleteEnvelopeBlobs` (`groupQueue.ts:808`) is called today at stage/batch dedup-squash, decode-failure, worker completion, and exhaust. Each becomes a holder release. The big `STAGE`/`DISPATCH`/`COMPLETE`/`RESTAGE` scripts stay **untouched**; the only new Lua is one small, self-contained release script.
- **A set, not a counter, on purpose.** `SREM` of an already-removed member is a no-op, so a doubly-processed completion cannot under-count and prematurely delete a still-live blob — the failure mode that becomes a "blob missing" handler crash. A bare `INCR`/`DECR` has no such idempotency.
- **One atomic release script does the reclaim.** `SREM holders(H) slotId; if SCARD(holders(H)) == 0 then UNLINK blob(H); DEL holders(H) end` runs in a single eval, so a completion racing a re-stage of the same content cannot delete a live blob — the one TOCTOU the set alone doesn't close. A `redis`-tier blob is `UNLINK`ed inline (deleting a key returns an integer — safe in Lua, unlike *reading* the binary body, which is why bodies are still written/read by the client directly); an `s3`-tier key is pushed to a reclaim list a best-effort sweeper drains via `StorageRegistry.delete` (Lua cannot reach S3). Happy path: a fan-out's blob is gone within seconds of its last job completing.
- **Retry is a no-op for the blob, and dispatch never releases.** A retry re-encodes the same content to the same hash, so the slot's hold persists across the re-stage — the blob is never released-then-needed. The blob also survives dispatch by design (dispatch moves the value to the worker but does not touch the hold). Only *terminal* retirement — complete, exhaust, squash-displacement, decode-failure — releases.
- **TTL backstop, refreshed on access.** Blob key and holder set both carry a **3-day** TTL (`SET … EX`), refreshed on every stage / dispatch / restage touch. A live reference keeps refreshing; only a reference untouched for 3 days ages out. Three days is sized to survive a weekend; the binding case is a *paused* pipeline, which does not access its blobs to refresh them, so the TTL must exceed the maximum pause window. The S3/file tier's backstop is the bucket lifecycle rule (the same safety net `stored_objects` and ADR-022 already rely on), sized ≥ the Redis TTL. All tunable via env.
- **Missing blob is a fail-safe, never a wedge.** Should a backstop ever fire under a still-referenced job (TTL mis-sized, sweeper bug), decode finds the blob gone and — exactly as ADR-026 — completes the slot without invoking the handler; the work is recoverable via event replay. Content-addressing plus the holder set makes this rare; it never makes it fatal.

### 4. Tenant-namespaced keys

Every blob key — Redis and S3 — is **namespaced by `projectId`**, which *is* the tenant id in this codebase (`tenantId === projectId` throughout; the queue already derives it via `tenantIdFromGroupId`). So the durable tier mints exactly the `stored_objects` layout `s3://{bucket}/{projectId}/<hash>` via `mintS3Uri` + `resolveProjectStorageDestination` (which also picks the per-project BYOC bucket / global / local-FS destination). Consequences:

- **Tenants never share a blob.** Two tenants with byte-identical content get distinct keys. Isolation is structural (in the key path), not incidental to the content.
- **Purge is tractable.** A project delete becomes a delete-by-prefix over `…/{projectId}/*` on the durable tier; the Redis tier's 3-day TTL makes its purge effectively immediate once the project's jobs drain. This closes the GDPR gap that a globally-keyed shared blob would have opened.
- **Logs must redact.** A BYOC tenant's bucket name is a cross-tenant disclosure channel; any log line carrying a blob URI goes through `redactStorageUri` (already provided by `stored-objects`).

### 5. GQ2 envelope + two-phase rollout

The envelope version bumps to `GQ2|`, marking a value as ref-bearing. This marker is load-bearing for rollout safety: refs ride *inside* the job value, so a value that carried them as plain JSON would `JSON.parse` cleanly on an old pod and hand the handler an unresolved `{ eventRef }` — silently wrong. The `GQ2|` prefix instead makes an old (GQ1-only) reader **drop the value and complete the slot without the handler**, recoverable via event replay — the same clean failure mode ADR-026 established. Rollout follows that discipline unchanged: every worker runs the resolve-adapter + tiered-store reader fleet-wide *before* any producer emits `GQ2`, gated by the existing `GROUP_QUEUE_ENVELOPE_WRITES_ENABLED` flag (now the ref-write gate). App and worker Deployments still roll independently.

## Rationale / Trade-offs

**Why content-address here when ADR-022 explicitly rejected sha256-per-field?** Opposite motivation for the same primitive. ADR-022's spool is one transient object per command, never shared, so a hash bought it nothing but cost — it rejected the *integrity* hash. Our blob is shared across a fan-out, and the hash *is the dedup key*. Different problem, justified differently.

**Why reuse the `stored-objects` driver but not `StoredObjectsService`?** `StorageDriver` (`get`/`put`/`delete`/`exists`, keyed by URI) and `StorageRegistry` (scheme dispatch) have zero ClickHouse coupling — they are exactly the byte primitive the durable tier needs, and they already give content-addressed, `projectId`-namespaced, BYOC-aware, multi-backend (S3 / local-FS / Azure) storage with idempotent PUTs. `StoredObjectsService` layers on a ClickHouse metadata row and a deliberately **no-GC** lifecycle (it relies on a project-delete cascade, per `externalize-event-byte-content.feature`). Adopting the service would import a lifecycle that contradicts our eager reclaim. So we reuse the *driver/registry/URI/destination* and keep our own holder-set reclaim, which calls `StorageRegistry.delete` directly. No clash: the no-GC stance is a service-level policy, not a driver constraint.

**Why hoist at the producer rather than the per-job encoder?** A per-job encoder hoist (content-addressing each job's body as it is staged) is the simpler alternative — no producer changes, and it rides the existing reclaim seams — but it under-delivers here. The heterogeneous payload shapes mean it dedups reactors among themselves at best, not across the spread-shaped projection jobs, and it re-serializes and re-`PUT`s the shared event once per job. The producer hoist normalizes the shapes and pays the serialize/`PUT` once. We accept the extra surface — the projection router's three fan-out points plus the resolve-adapter on the read side — to get the full dedup and the network-burst relief, which is the actual capacity win. The holder/reclaim machinery is identical either way (it keys on whatever ref the encoded value carries), so this choice is isolated to the hoist.

**Why eager reclaim plus a long backstop, rather than pure-TTL or pure-refcount?** The two constraints — survive a 3-day outage *and* not accumulate 3 days of payloads — are jointly unsatisfiable by either mechanism alone. Eager reclaim clears the ~99% happy path in seconds; the TTL bounds the long tail, turning every conceivable bookkeeping bug into "reclaimed within 3 days" rather than "leaked forever." The set-based holder makes a *missed* `SREM` degrade to "reclaimed at TTL" and a *double* `SREM` a no-op — the two seatbelts that make threading the reclaim through every lifecycle path survivable.

**Why holder-set over integer refcount?** Idempotency, as above. The cost is a small set of short ids per blob — trivially smaller than the blob it guards.

**What it costs.** The flat-job small case pays an extra round trip: a 200-byte singleton job with nothing to dedup would round-trip a blob for no benefit — which is why the `inline` tier (≤4 KiB) keeps such jobs in the envelope body. "Always flat" is the spirit; "flat above 4 KiB" is the rule. `resolveProjectStorageDestination` does a per-project lookup (BYOC bucket resolution), so the durable tier should cache the destination per `projectId` at queue volume rather than resolve per PUT. Ops debugging loses `redis-cli` readability for refs (already true for ADR-026 compressed/offloaded bodies; the decode helper extends to resolve refs). The reclaim bookkeeping is TS-orchestrated at the queue's existing retire seams plus one small release script — the big lifecycle Lua (`stage`/`dispatch`/`complete`/`restage`) is left untouched, which is where most of the risk would otherwise live. What risk remains is the producer hoist + resolve-adapter (a new read-side code path) and the holder-release races, both bounded by the atomic release script and the TTL backstop; the worst residual case is the (safe) missing-blob fail-safe.

## Consequences

**Positive.** A fan-out's Redis footprint drops from N copies to one blob plus N tiny flat jobs — roughly a fan-out-factor reduction, exactly under burst. Worker CPU serializes and gzips the shared component once, not N times. An outage backlog holds one copy per distinct event instead of N, so the very scenario the 3-day TTL exists for is itself fan-out-factor cheaper than today. Offload collapses toward one mechanism keyed on size, and the durable tier rides the codebase's existing object store instead of adding a fourth one.

**Negative.** More moving parts in the lifecycle Lua (holder sets, the S3 reclaim list, the sweeper). A fresh two-phase rollout to manage (GQ2). A pipeline paused longer than the TTL falls to the replay fail-safe — mitigated by sizing the TTL above the maximum pause window, or by pause-aware refresh later. The durable tier inherits `stored-objects`' per-project destination resolution, which must be cached at queue volume.

**Neutral.** Handlers, the queue-manager facades' public API, dedup-id squash semantics, and every key shape other than the new `blob` namespacing / `blobholders` / reclaim keys are untouched. This replaces ADR-026's blob lifecycle; ADR-026's envelope, header-routing, and two-phase-rollout decisions stand.

## References

- Extends / supersedes-in-part: [ADR-026](./026-groupqueue-payload-envelope.md) (GroupQueue payload envelope)
- Reuses: `src/server/stored-objects/` (`StorageDriver` / `StorageRegistry` / `uri.ts` / `project-storage-destination.ts`) — contract in `specs/features/scenarios/externalize-event-byte-content.feature`
- Distinct from: [ADR-022](./022-event-log-source-of-truth.md) (event_log SoT — its `BlobStore` is event_log-centric, not reused)
- Disambiguation: [ADR-024](./024-cold-path-tiered-storage.md) (cold-path tiered storage — ClickHouse, not the queue)
- Related: [ADR-007](./007-event-sourcing-architecture.md) (event sourcing); dedup-id squash in `specs/traces/record-span-gq-dedup.feature` and `specs/event-sourcing/deduplication-strategy.feature`
- Spec: `specs/event-sourcing/payload-store-content-addressed.feature`
- Supersedes the blob-lifecycle scenarios in `specs/event-sourcing/payload-envelope.feature`

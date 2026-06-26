# ADR-030: GroupQueue blob-handling hardening

**Date:** 2026-06-20

**Status:** Proposed

**Amends:** [ADR-029](./029-groupqueue-content-addressed-payload-store.md) (GroupQueue content-addressed tiered payload store). ADR-029's tiered store, GQ2 envelope, holder-set reclaim, and queue wiring stand; this ADR hardens the blob lifecycle against the correctness, security, and design gaps a three-pass review (tests / security / code) surfaced after the implementation landed.

**Relates to:** [ADR-022](./022-event-log-source-of-truth.md) (the edge `COMMAND_INLINE_THRESHOLD` this revisits), `src/server/stored-objects/` (the reused object store).

## Context

The GQ2 content-addressed offload shipped across eight commits. Reviewing it end-to-end found that the blob lifecycle is correct on the happy path but trusts stored state, non-atomic sequencing, and unbounded inputs in ways that break under partial failure, store tamper, or pathological size — and that the lifecycle is untestable in isolation because it's threaded through the 1224-LOC `GroupQueueProcessor`. See [specs/event-sourcing/payload-store-blob-hardening.feature](../../../specs/event-sourcing/payload-store-blob-hardening.feature) for the behavioural contract this decision supports.

The findings cluster into three roots: **unbounded inputs** (a huge payload OOMs the worker at `JSON.stringify`/gzip), **trusted state + non-atomic steps** (a tampered ref or a partial-failure between acquire and release misbehaves), and **untestability** (the seams need a whole processor to exercise).

## Decision

### 1. Bounded-memory offload: cap the absolute size, hash over the raw source

`JSON.stringify` → gzip → buffered `PUT` is the offload path. Two changes harden it:

- An **absolute ceiling** `MAX_BLOB_BYTES` (**50 MiB**) bounds the one unavoidable allocation — the JSON string itself. Above it the job is **rejected at encode** with `PayloadTooLargeError`, so the producer surfaces the error rather than the worker OOMing on gzip + buffer. Exceeding the ceiling means an upstream cap (ADR-022's edge spool, `leanForProjection`'s 64 KiB IO preview) was bypassed — a bug to surface, not silently absorb. Worst-case worker memory is bounded at roughly `concurrency × MAX_BLOB_BYTES`.
- Content addressing hashes the **raw source JSON** (passed as a separate `hashSource`), not the gzipped bytes, removing the dependency on gzip being byte-deterministic across zlib versions/levels. The store stays byte-symmetric — it stores and returns the gzipped `data`; `hashSource` only sets the `{projectId}/{hash}` key.

**Streaming was considered and dropped.** A true multipart-streaming tier would need an object-store `putStream` across every driver plus the `@aws-sdk/lib-storage` dependency — a `stored-objects` change outside this change's event-sourcing-only scope — and it buys only marginal memory: the source `JSON.stringify` string is held regardless of buffered-vs-streamed, so the real worst-case is `concurrency × ceiling` of source strings, bounded by the **ceiling**, not a stream boundary. The cap is the OOM bound; the s3-tier threshold stays at 256 KiB (redis-vs-s3, both buffered).

### 2. Distinguish a missing blob from a transient store error

`TieredBlobStore.get` for the s3 tier must classify failures: a genuine *not-found* (`NoSuchKey` / 404) returns null → the decode fail-safe (complete the slot without the handler, recover via replay). A *transient* error (5xx, throttling, timeout, connection reset) **rethrows as retryable** so the queue's normal retry handles it. Today both collapse to "missing", so a brief S3 blip mass-drops in-flight jobs to replay instead of retrying.

### 3. Coordinated, access-refreshed TTLs

One `BLOB_BACKSTOP_TTL_SECONDS` constant drives both the blob and the holder-set TTL (no two-literal drift), with the invariant **holder-set TTL ≥ blob TTL**, and **both are refreshed on access** — dispatch refreshes the holder set as well as the blob (today only the blob is). This closes the premature-reclaim window where a long-lived fan-out's holder set expires while its blob is still being refreshed, dropping all members and reclaiming a blob siblings still reference.

### 4. Atomic acquire→release transfer

The retry and dedup-squash transitions move a hold from an old token to a new one on the same content hash. ADR-029 relied on calling acquire before release; that ordering holds under single-connection FIFO but not under a partial failure (acquire fails, release succeeds → premature reclaim). Replace the two un-awaited ops at those transitions with a **single transfer eval**: `SADD new; SREM old; reclaim the old blob iff its holder is now empty` — atomic, so no interleaving or partial failure can reclaim a blob the new reference needs. The plain stage path keeps the cheap fire-and-forget acquire.

### 5. Re-mint location on read — don't trust the stored ref

Decode derives the read location from server-trusted inputs — the redis key from `(projectId, hash)`, the s3 uri by re-minting via `resolveProjectStorageDestination(projectId)` + `mintS3Uri` — rather than trusting `ref.uri` carried in the envelope. A tampered envelope (requires queue-store write access) can otherwise point a read at another tenant's key/bucket; re-minting makes the stored uri advisory, not authoritative. The per-project destination is cached to avoid a resolve per read.

**Tenant-attributed logging.** Every blob/holder/job log line MUST carry the owning `projectId`, log the tenant-scoped reference (`projectId` + content hash) rather than a bare hash, and never log the raw s3 uri or bucket name (use `redactStorageUri`). A log that names a blob without its tenant is a cross-tenant attribution hazard — logs are a real isolation surface. The blob lifecycle's previously-silent fire-and-forget failures now `warn` with `{ projectId, blobHash, tier }`, and the decode-failure (missing-blob) log carries the `projectId` too.

### 6. Cluster-slot guard

The release/transfer evals touch two keys (holder + blob) and are correct only if both land in one Redis Cluster slot — which depends entirely on the queue name carrying a hash tag (`{…}`). Assert this **at construction** and fail fast, rather than letting a hash-tag-less queue name silently `CROSSSLOT` and leak every blob to its TTL.

### 7. Extract the blob lifecycle into a collaborator

Pull the tiered store + holders construction, `projectId` resolution, and the acquire/release/reclaim/re-mint seams out of `GroupQueueProcessor` into a single-responsibility collaborator the processor delegates to — a domain noun (e.g. `EnvelopeBlobLifecycle`), **not** a `*Manager` (CLAUDE.md bans the suffix). This shrinks the processor and — the point — makes every seam unit-testable without standing up the whole queue.

### 8. Test and tidy

Add a `GroupQueue` GQ2 integration test (testcontainers) exercising the lifecycle end-to-end: offload → dispatch → reclaim, fan-out dedup, retry-keeps-blob, missing-blob fail-safe, s3 reclaim. Remove the production-dead `readEnvelopeRef` (subsumed by `readEnvelopeHold`). De-duplicate the in-memory `JobBlobStore` / `ObjectStore` test doubles into a shared helper.

## Rationale / Trade-offs

**Why a cap rather than streaming?** Streaming was the original plan — stream the gzip body to S3 above a 5 MiB boundary to avoid materialising a compressed buffer. But the source `JSON.stringify` string is held regardless of buffered-vs-streamed, so the real worst-case worker memory is `concurrency × ceiling` of source strings, bounded by the **ceiling**, not a stream boundary; streaming saves only the (smaller) gzip buffer. And a true streaming tier would need a `putStream` across every object-store driver plus the `@aws-sdk/lib-storage` dependency — outside this change's event-sourcing-only scope. So the ceiling is the memory bound, and streaming is dropped. Hashing the source string (not the gzip output) is kept regardless — it removes the gzip-determinism assumption.

**Why atomic transfer over awaiting acquire?** Awaiting acquire before release fixes the ordering but still leaves a window if the process dies between them. One eval is the only way the transition is crash-atomic; the keys are already co-slot, so it's a two-key eval like the release it replaces — small marginal cost.

**Why re-mint when the store is "trusted"?** Defence-in-depth at a tenant boundary is cheap here (a cached resolve), and "the queue's Redis is trusted" is exactly the assumption that erodes — a confused-deputy writer or a shared-bucket misconfiguration shouldn't become a cross-tenant read. The stored uri becomes a hint, not an authority.

**What it costs.** A cached per-project destination resolver on the read path, one new transfer eval, a construction-time assertion, and a refactor that moves ~150 LOC out of the processor into a collaborator. The refactor is the largest diff but pays for itself in testability.

## Consequences

**Positive.** Worker memory is bounded regardless of payload size; a transient store blip retries instead of dropping work to replay; a long-lived fan-out can't prematurely reclaim a referenced blob; a partial failure or a tampered ref can't reclaim-early or cross tenants; a mis-tagged queue name fails fast instead of leaking silently; and the whole lifecycle is unit-testable.

**Negative.** More surface (transfer eval, collaborator). The absolute ceiling introduces a reject path that didn't exist (a producer-visible `PayloadTooLargeError`). The destination cache adds an invalidation concern (bounded — BYOC bucket changes are rare, picked up on the next worker restart).

**Neutral.** Handler API, dedup-id squash semantics, and the GQ2 envelope format are unchanged; this is hardening behind the same boundary.

## References

- Amends: [ADR-029](./029-groupqueue-content-addressed-payload-store.md)
- Reuses: `src/server/stored-objects/` (object PUT/GET, destination resolver)
- Spec: `specs/event-sourcing/payload-store-blob-hardening.feature`
- Core contract: `specs/event-sourcing/payload-store-content-addressed.feature` (ADR-029)

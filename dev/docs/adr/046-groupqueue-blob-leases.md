# ADR-046: GroupQueue blob leases replace holder-set reference counting

**Date:** 2026-07-17

**Status:** Proposed

**Amends:** [ADR-029](./029-groupqueue-content-addressed-payload-store.md) (content-addressed tiered payload store) and [ADR-030](./030-groupqueue-blob-handling-hardening.md) (blob-handling hardening). The tiered store, content addressing, tenant namespacing, size caps, and transient-vs-missing classification all stand. What this ADR removes is the **eager-reclaim reference-counting plane** — the per-blob holder sets, hold tokens, and atomic acquire/release/transfer machinery — replacing it with time-based leases. It also retires the GQ1 *write* path and the `GROUP_QUEUE_ENVELOPE_WRITES_ENABLED` phase gate (readers for GQ1 and legacy bare JSON remain).

## Context

ADR-029 gave every offloaded blob a reference count so it could be reclaimed the moment its last referencing job retired. The count is a per-blob Redis SET of random hold tokens, and keeping it consistent requires participation from every lifecycle transition: the producer acquires after staging, the consumer releases on completion, a retry transfers atomically, a dedup squash transfers *inside the stage eval*, mixed GQ1/GQ2 values take an ordered fallback, and s3-tier reclaims complete out of band because Lua cannot reach the object store. Two TTLs (blob and holder) back all of it up, with a documented ordering invariant between them.

That machinery has been the queue's largest source of defects since it shipped:

- **2026-07-09**: concurrent dedup squashes reordered fire-and-forget hold transfers, leaving phantom tokens that pinned ~279K orphaned blobs (~1.9 GB of production Redis). The fix moved transfers into the stage eval — more Lua.
- **2026-07-11**: fire-and-forget acquire/release could be dropped by a dying worker; both became awaited.
- Still open at the time of writing: the producer acquires its hold *after* `stage()` returns, so a fast completion (or a concurrent same-content release) races it — a phantom hold on one side, a premature reclaim on the other; operator drains and DLQ moves bypass the refcount entirely and leak every hold to the TTL; and the DLQ retains values for 7 days while the blob backstop is 4, so a late DLQ replay loses its offloaded bodies.

Meanwhile, eager reclaim has **no correctness role**. Content-addressed PUTs are idempotent, decode already distinguishes transient store failures from genuinely missing blobs (ADR-030 §2), and a missing body terminates at the drop path with full observability (#5538). Reclaim timing is purely a Redis-memory optimisation for the 4–256 KiB tier — the s3 tier's true reclaim mechanism is already the bucket lifecycle policy, as the code's own "orphaned until bucket lifecycle sweeps" warn path admits.

## Decision

**We will stop reference-counting blobs.** Blob lifetime becomes a lease:

1. **Redis-tier blobs get a lease TTL at PUT** — default equal to the previous backstop (4 days, `LANGWATCH_GQ_BLOB_LEASE_SECONDS` to retune) — **refreshed on every read** (the existing GETEX) and effectively refreshed by every retry re-encode (an idempotent re-PUT of the same content). Worst-case retention is therefore identical to the previous TTL-backstop behaviour; what changes is that the backstop *is* the mechanism rather than the safety net behind a refcount.
2. **Blocking and DLQ moves extend leases instead of copying bodies.** `RESTAGE_AND_BLOCK` and `MOVE_TO_DLQ` parse each staged value's blob ref in Lua (the header parser already exists there) and `EXPIRE ... GT` the blob key to at least the DLQ retention window. Content-addressed blobs are shared, so extending is a max over interested parties. This *structurally* closes the DLQ-replay body-loss gap: a group's bodies now always outlive its DLQ residence. It is also strictly better than the refcount design for blocked groups, whose holds nothing refreshed — a group blocked more than 4 days already lost its bodies.
3. **The s3 tier has no application-side deletes at all.** Reclaim is a documented bucket lifecycle rule on the queue's object prefix (recommended: 14 days, comfortably above DLQ retention); the self-hosted file driver documents disk as the backstop. Project purge remains delete-by-prefix.
4. **The holder plane is deleted**: `blobHolders.ts` and its release/transfer Lua, the squash-transfer helpers in the stage scripts (the stage return shrinks back to "was it new"), the `h` token in the GQ2 header (readers tolerate it on in-flight values), and every acquire/release/transfer call site in the processor.
5. **GQ1 writes and the `GROUP_QUEUE_ENVELOPE_WRITES_ENABLED` gate are retired.** The gate has been on in production since the GQ2 rollout; readers for every format ever written (GQ2, GQ1, bare JSON) have shipped for months and remain. Writes are now unconditionally GQ2: tiered offload when the store and tenant are available, inline GQ2 otherwise (the previously-silent GQ1 downgrade becomes an inline-GQ2 downgrade with the same warn + counter). Self-hosted installs flip from bare-JSON to GQ2 writes on upgrade; their own readers have understood envelopes since ADR-026.

## Rationale / Trade-offs

The complexity was not in the data structure — it was in the **coupling**: five lifecycle transitions across two processes and three Lua scripts all had to agree on hold state, and each incident fix added a participant. Leases collapse the agreement problem to "reads refresh, rare transitions extend", both of which are single-key, idempotent operations with no ordering constraints. The phantom-hold, acquire-after-stage, drain-leak, and DLQ-loss defect classes cease to exist rather than being patched.

What we give up is eager memory reclaim on the redis tier: a blob now lives for its lease rather than its residence. The 2026-07-09 incident is the sizing anchor — several days of a large fraction of squash traffic accumulated to 1.9 GB — so a 4-day lease over all offloaded traffic lands in the same single-digit-GB range on an ElastiCache node an order of magnitude larger. Two knobs bound it further: the lease itself, and `S3_TIER_THRESHOLD_BYTES` (lowering it shifts traffic to the durable tier). A one-off `SCAN` + `MEMORY USAGE` sweep of the `:gq:blob:` prefix before and after the cutover confirms the estimate and informs tightening the lease to 24h.

Eager s3 deletion is also given up, deliberately: the lifecycle rule was already the real mechanism, and the deleted code path (release → `reclaim-s3` verdict → out-of-band delete → failure counter) existed to approximate what the rule does natively.

**Alternatives considered.** Two-tier only (inline + s3, no redis tier) is simpler still but puts a 20–60 ms object-store round trip and PUT costs on the *common* 4–256 KiB hot path — worth revisiting only if the sizing sweep shows the redis-tier population is trivial. Lease-scored ZSET holders (the `tenant_active_z` pattern) simplify the structure but keep the cross-transition coupling that is the actual defect source. Staging references into the event store instead of carrying bodies is principled but adds a ClickHouse read plus replication-lag handling to every dispatch — a larger behavioural change than the problem warrants.

**Rolling-deploy safety.** New writers emit token-less GQ2 headers; old workers' release of a token-less value is a no-op by construction (`readEnvelopeHold` returns null). Old values with tokens processed by new workers simply never release; their holder sets and blobs expire on the existing TTLs — a one-time, bounded memory tail. No flag is needed; rollback is a revert (old readers GETEX blobs back onto the old TTL).

## Consequences

- The queue's trickiest ~1,000 lines (holder Lua, transfer fallbacks, squash-hold plumbing, ordered acquire/release sequencing) are deleted; the blob lifecycle collaborator shrinks to encode/decode plus the read-side tenant guard.
- Redis-tier memory becomes `offload rate × lease ÷ dedup factor` instead of `residence + orphans` — measured, bounded, and tunable, at the cost of no longer being minimal.
- The DLQ/blocked/replay paths carry their bodies reliably for the first time.
- One write format on the wire (GQ2). GQ1 and bare-JSON *readers* remain until in-flight residence plus DLQ retention has passed a release cycle, then can be deleted in a follow-up.
- Operators must provision the bucket lifecycle rule (or accept unbounded s3 growth); the Helm chart docs gain a note.

## References

- Related ADRs: [ADR-026](./026-groupqueue-payload-envelope.md), [ADR-029](./029-groupqueue-content-addressed-payload-store.md), [ADR-030](./030-groupqueue-blob-handling-hardening.md)
- Specs: `specs/event-sourcing/payload-store-content-addressed.feature`, `specs/event-sourcing/payload-store-blob-lease.feature`
- Incidents: 2026-07-09 phantom-hold blob leak; 2026-05/06 Redis saturation family

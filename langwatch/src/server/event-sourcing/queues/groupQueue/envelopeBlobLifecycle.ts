import { createLogger } from "@langwatch/telemetry";
import { Cluster, type Redis as IORedis } from "ioredis";
import { tenantIdFromGroupId } from "../../../observability/tenantRateTracker";
import {
  type ProjectStorageDestination,
  redactStorageUrisInText,
} from "../../../stored-objects/project-storage-destination";
import { createTenantId, type TenantId } from "../../domain/tenantId";
import { BlobHolders } from "./blobHolders";
import {
  decodeJobEnvelope,
  encodeJobEnvelope,
  isEnvelope,
  readEnvelopeHold,
  readEnvelopeHoldFromHeader,
  readEnvelopeRetirement,
  splitEnvelope,
} from "./jobEnvelope";
import { gqBlobReclaimS3FailuresTotal } from "./metrics";
import { hasRedisHashTag } from "./redisHashTag";
import { RedisJobBlobStore } from "./redisJobBlobStore";
import { type ObjectStore, TieredBlobStore } from "./tieredBlobStore";

const logger = createLogger("langwatch:event-sourcing:envelope-blob-lifecycle");

/**
 * Owns the GQ2 content-addressed blob lifecycle for a GroupQueue — the tiered
 * store, the holder-set refcount, and the encode / decode / acquire / release
 * seams — so the queue processor delegates rather than carrying it inline, and
 * the seams are exercisable without standing up the whole queue. See ADR-030.
 */
export class EnvelopeBlobLifecycle {
  private readonly blobs: RedisJobBlobStore;
  private readonly blobHolders: BlobHolders;
  private readonly tieredBlobs?: TieredBlobStore;
  private readonly queueName: string;
  private readonly writesEnabled?: boolean;

  constructor({
    redis,
    queueName,
    objectStoreFor,
    resolveStorageDestination,
    writesEnabled,
  }: {
    redis: IORedis | Cluster;
    queueName: string;
    objectStoreFor?: (projectId: string) => ObjectStore;
    resolveStorageDestination?: (
      projectId: string,
    ) => Promise<ProjectStorageDestination>;
    /**
     * Explicit override of the format-rollout gate. Threaded through to
     * {@link encodeJobEnvelope} so the composition root — not per-call
     * `process.env` reads — decides when the queue starts emitting GQ2
     * envelopes. Omit to fall back to the `GROUP_QUEUE_ENVELOPE_WRITES_ENABLED`
     * env var (call-time read so tests can toggle without module reload).
     */
    writesEnabled?: boolean;
  }) {
    this.queueName = queueName;
    this.writesEnabled = writesEnabled;
    // The holder release/transfer evals touch two keys (holder + blob); in
    // cluster mode they must share a slot, which requires the queue name to
    // carry a hash tag. Fail fast rather than CROSSSLOT-leak silently at runtime
    // (ADR-030 §6). A single Redis has no slots, so the check is cluster-only.
    if (redis instanceof Cluster && !hasRedisHashTag(queueName)) {
      throw new Error(
        `GroupQueue "${queueName}" needs a Redis hash tag ({...}): the holder ` +
          `release/transfer evals touch the holder and blob keys, which must ` +
          `share one cluster slot.`,
      );
    }
    this.blobs = new RedisJobBlobStore({ redis, queueName });
    this.blobHolders = new BlobHolders({ redis, queueName });
    // The tiered store is active only when the composition root supplies an
    // object store + destination resolver; otherwise encode falls back to GQ1's
    // randomUUID offload.
    this.tieredBlobs =
      objectStoreFor && resolveStorageDestination
        ? new TieredBlobStore({
            redisBlobs: this.blobs,
            objectStoreFor,
            resolveDestination: resolveStorageDestination,
            queueName,
            logger,
          })
        : undefined;
  }

  /**
   * The branded tenant id owning a group, or undefined when the groupId carries
   * no tenant prefix. This is the validation boundary: every projectId reaching
   * the blob store / holder set is a `TenantId` minted here, so a raw string
   * can't be used to namespace a blob (tenant-isolation safety at the type level).
   */
  private projectIdFor(groupId: string): TenantId | undefined {
    const tenantId = tenantIdFromGroupId(groupId);
    return tenantId ? createTenantId(tenantId) : undefined;
  }

  /**
   * Encodes a job payload into a staged envelope, offloading a large body to the
   * content-addressed tiered store under the group's tenant namespace.
   */
  async encode({
    jobData,
    groupId,
  }: {
    jobData: Record<string, unknown>;
    groupId: string;
  }): Promise<string> {
    return encodeJobEnvelope({
      jobData,
      blobs: this.blobs,
      tieredBlobs: this.tieredBlobs,
      projectId: this.projectIdFor(groupId),
      writesEnabled: this.writesEnabled,
      queueName: this.queueName,
      logger,
    });
  }

  /** Decodes a staged envelope back into the job payload, resolving any offloaded blob. */
  async decode({
    value,
    groupId,
  }: {
    value: string;
    groupId: string;
  }): Promise<Record<string, unknown>> {
    // Parse the envelope ONCE here on the hot path; the header carries both
    // the hold token (for the tenant guard + touch) and the routing needed to
    // decode the body. Passing the parsed tuple into decodeJobEnvelope skips a
    // second Buffer.from + JSON.parse (2026-06-24 review).
    const parsed = isEnvelope(value) ? splitEnvelope(value) : undefined;
    const hold = parsed ? readEnvelopeHoldFromHeader(parsed.header) : null;
    if (hold) {
      // Defense-in-depth: the blob ref's tenant must match the group's tenant.
      // A forged or mis-routed ref must never read another tenant's blob, so
      // refuse before fetching and let the missing-blob fail-safe run (ADR-030 §5).
      const expected = this.projectIdFor(groupId);
      if (hold.ref.projectId !== expected) {
        logger.warn(
          {
            projectId: expected,
            refProjectId: hold.ref.projectId,
            blobHash: hold.ref.hash,
            groupId,
          },
          "Blob ref tenant mismatch; refusing cross-tenant read",
        );
        throw new Error("Blob ref tenant mismatch");
      }
    }
    const decoded = await decodeJobEnvelope({
      value,
      blobs: this.blobs,
      tieredBlobs: this.tieredBlobs,
      parsed,
    });
    // The decode's GETEX refreshed the blob TTL; refresh the holder set too so a
    // still-referenced blob's holder never expires before it (ADR-030 §3).
    if (hold) {
      void this.blobHolders
        .touch({ projectId: hold.ref.projectId, hash: hold.ref.hash })
        .catch((err: unknown) => {
          logger.warn(
            {
              projectId: hold.ref.projectId,
              blobHash: hold.ref.hash,
              err: redactStorageUrisInText(
                err instanceof Error ? err.message : String(err),
              ),
            },
            "Blob holder TTL refresh failed; relying on the margin",
          );
        });
    }
    return decoded;
  }

  /**
   * Acquires this staged occupancy's hold on its GQ2 blob (no-op for GQ1,
   * inline, and legacy values). Awaited by the caller (2026-07-11 fix): this
   * was previously fire-and-forget, which let a killed worker process drop
   * the acquire silently — before it ever reached Redis — leaving a
   * concurrent squash's release free to reclaim a blob this occupancy still
   * needed. A failed acquire still only warns and degrades to the TTL
   * backstop; it never throws to the caller.
   */
  async acquire(value: string): Promise<void> {
    const hold = readEnvelopeHold(value);
    if (!hold) return;
    try {
      await this.blobHolders.acquire({
        projectId: hold.ref.projectId,
        hash: hold.ref.hash,
        slotId: hold.token,
      });
    } catch (err) {
      // Tenant-attributed (never a bare hash, never the bucket): every blob
      // log line carries the owning projectId so logs can't cross tenants.
      logger.warn(
        {
          projectId: hold.ref.projectId,
          blobHash: hold.ref.hash,
          tier: hold.ref.tier,
          err: redactStorageUrisInText(
            err instanceof Error ? err.message : String(err),
          ),
        },
        "Blob holder acquire failed; relying on the TTL backstop",
      );
    }
  }

  /**
   * Releases holds for retired staged values: a GQ2 value releases its holder —
   * reclaiming the blob when the last hold drops, deleting an s3 object
   * out-of-band; a legacy GQ1 value deletes its randomUUID blob. Awaited by
   * the caller (2026-07-11 fix): this was previously fire-and-forget, so a
   * killed worker process could drop a release before it reached Redis,
   * leaking the holder (or, combined with a concurrent transfer, racing it).
   * Each value's release still degrades to a warn + the TTL backstop rather
   * than throwing — one bad value must not abort the rest of the batch.
   */
  async release({
    values,
    groupId,
  }: {
    values: string[];
    groupId: string;
  }): Promise<void> {
    const expected = this.projectIdFor(groupId);
    await Promise.all(
      values.map(async (value) => {
        // Single parse per value: hold + GQ1 blobId from one splitEnvelope so a
        // maxBatch=10 coalesced completion doesn't do ~20 redundant Buffer.from +
        // JSON.parse (2026-06-24 review).
        const { hold, blobId } = readEnvelopeRetirement(value);
        if (hold) {
          // Tenant guard: never release a hold whose ref isn't this group's
          // tenant. A mis-routed or forged GQ2 value must not reclaim another
          // tenant's blob on the fail-safe cleanup path (ADR-030 §5).
          if (hold.ref.projectId !== expected) {
            logger.warn(
              {
                projectId: expected,
                refProjectId: hold.ref.projectId,
                blobHash: hold.ref.hash,
                groupId,
              },
              "Skipping blob release for a tenant-mismatched ref",
            );
            return;
          }
          try {
            const outcome = await this.blobHolders.release({
              projectId: hold.ref.projectId,
              hash: hold.ref.hash,
              tier: hold.ref.tier,
              slotId: hold.token,
            });
            if (outcome === "reclaim-s3" && this.tieredBlobs) {
              try {
                await this.tieredBlobs.delete(hold.ref);
              } catch (err) {
                // S3 reclaim failed — the holder is already gone, so no future
                // release will retry this object. Warn AND counter so oncall
                // sees a recurring failure before the bucket-lifecycle
                // backstop kicks in (2026-06-24 review).
                gqBlobReclaimS3FailuresTotal.inc({
                  queue_name: this.queueName,
                });
                logger.warn(
                  {
                    projectId: hold.ref.projectId,
                    blobHash: hold.ref.hash,
                    err: redactStorageUrisInText(
                      err instanceof Error ? err.message : String(err),
                    ),
                  },
                  "S3 blob reclaim failed after holder drop — orphaned until bucket lifecycle sweeps",
                );
              }
            }
          } catch (err) {
            logger.warn(
              {
                projectId: hold.ref.projectId,
                blobHash: hold.ref.hash,
                tier: hold.ref.tier,
                err: redactStorageUrisInText(
                  err instanceof Error ? err.message : String(err),
                ),
              },
              "Blob holder release/reclaim failed; relying on the TTL backstop",
            );
          }
          return;
        }
        if (blobId) {
          try {
            await this.blobs.delete({ id: blobId });
          } catch {
            // GQ1 blobs have no refcount/backstop beyond their own TTL;
            // best-effort cleanup only.
          }
        }
      }),
    );
  }

  /**
   * Deletes the s3 object of a blob whose LAST hold was already dropped inside
   * a stage eval (the dedup-squash hold transfer runs in Lua, which cannot
   * reach s3 — the eval reports `reclaimS3` and this finishes the job).
   * Awaited by the caller (2026-07-11 fix), same rationale as {@link release}.
   * Same failure telemetry as the release path either way.
   */
  async reclaimOrphanedS3({
    value,
    groupId,
  }: {
    value: string;
    groupId: string;
  }): Promise<void> {
    const hold = readEnvelopeHold(value);
    if (!hold || hold.ref.tier !== "s3" || !this.tieredBlobs) return;
    // Same guard as release(): never delete an object whose ref isn't this
    // group's tenant (ADR-030 §5).
    if (hold.ref.projectId !== this.projectIdFor(groupId)) {
      logger.warn(
        {
          projectId: this.projectIdFor(groupId),
          refProjectId: hold.ref.projectId,
          blobHash: hold.ref.hash,
          groupId,
        },
        "Skipping S3 reclaim for a tenant-mismatched ref",
      );
      return;
    }
    try {
      await this.tieredBlobs.delete(hold.ref);
    } catch (err) {
      gqBlobReclaimS3FailuresTotal.inc({ queue_name: this.queueName });
      // Tenant-attributed (never a bare hash, never the bucket): every blob
      // log line carries the owning projectId so logs can't cross tenants.
      logger.warn(
        {
          projectId: hold.ref.projectId,
          blobHash: hold.ref.hash,
          err: redactStorageUrisInText(
            err instanceof Error ? err.message : String(err),
          ),
        },
        "S3 blob reclaim failed after squash-transfer holder drop — orphaned until bucket lifecycle sweeps",
      );
    }
  }

  /**
   * Atomically moves the hold from a retired value to its replacement (retry
   * re-encode or dedup squash): one eval adds the new hold, drops the old, and
   * reclaims the old blob if newly unreferenced — no acquire-then-release gap in
   * which a partial failure could reclaim a live blob (ADR-030 §4). Falls back to
   * ordered acquire+release when either side isn't a GQ2 hold.
   *
   * Awaited by the caller (2026-07-11 fix): this was previously fire-and-forget
   * end to end, so a killed worker process — or simply a subsequent squash on
   * the same group racing ahead before this one's Redis round trip landed —
   * could interleave with another transfer/release for the same blob in
   * whatever order the network happened to deliver them, rather than the
   * caller's own call order. Awaiting makes each transfer complete (or fail
   * loudly into its own warn) before the next squash on this group can start
   * its own.
   */
  async transfer({
    newValue,
    oldValue,
    groupId,
  }: {
    newValue: string;
    oldValue: string;
    groupId: string;
  }): Promise<void> {
    const expected = this.projectIdFor(groupId);
    const newHold = readEnvelopeHold(newValue);
    const oldHold = readEnvelopeHold(oldValue);
    // A tenant-mismatched newValue must not acquire a foreign holder (the
    // mirror of the release-side guard). Skip both sides — the guarded release
    // also drops the old holder iff its tenant matches (ADR-030 §5).
    if (newHold && newHold.ref.projectId !== expected) {
      logger.warn(
        {
          projectId: expected,
          refProjectId: newHold.ref.projectId,
          blobHash: newHold.ref.hash,
          groupId,
        },
        "Skipping blob acquire for a tenant-mismatched replacement ref",
      );
      await this.release({ values: [oldValue], groupId });
      return;
    }
    // Fall back to ordered acquire+release when either side isn't a GQ2 hold, or
    // when the old ref isn't this group's tenant — the guarded release then
    // skips the foreign hold, leaving it to its TTL (ADR-030 §5).
    //
    // This branch dominates during the GQ1 → GQ2 rollout window: new encodes
    // are GQ2 but in-flight staged values are still GQ1, so `!oldHold` fires
    // on every retry/squash. Acquire-then-release is ORDERED (not parallel
    // fire-and-forget) so a release-before-acquire race can't drop the old
    // blob before the new hold is recorded (2026-06-24 review). It's not
    // atomic like TRANSFER_LUA — extending the Lua for the mixed-format case
    // is tracked as a follow-up.
    if (!newHold || !oldHold || oldHold.ref.projectId !== expected) {
      try {
        await this.acquireAwait(newValue);
      } catch (err) {
        logger.warn(
          {
            refProjectId: newHold?.ref.projectId,
            blobHash: newHold?.ref.hash,
            groupId,
            err: err instanceof Error ? err.message : String(err),
          },
          "transfer fallback: acquire failed; skipping release to keep old blob alive under TTL",
        );
        return;
      }
      await this.release({ values: [oldValue], groupId });
      return;
    }
    try {
      const outcome = await this.blobHolders.transfer({
        newProjectId: newHold.ref.projectId,
        newHash: newHold.ref.hash,
        newSlotId: newHold.token,
        oldProjectId: oldHold.ref.projectId,
        oldHash: oldHold.ref.hash,
        oldTier: oldHold.ref.tier,
        oldSlotId: oldHold.token,
      });
      if (outcome === "reclaim-s3" && this.tieredBlobs) {
        try {
          await this.tieredBlobs.delete(oldHold.ref);
        } catch (err) {
          gqBlobReclaimS3FailuresTotal.inc({ queue_name: this.queueName });
          logger.warn(
            {
              projectId: oldHold.ref.projectId,
              blobHash: oldHold.ref.hash,
              err: redactStorageUrisInText(
                err instanceof Error ? err.message : String(err),
              ),
            },
            "S3 blob reclaim failed after transfer — orphaned until bucket lifecycle sweeps",
          );
        }
      }
    } catch (err) {
      logger.warn(
        {
          projectId: oldHold.ref.projectId,
          blobHash: oldHold.ref.hash,
          tier: oldHold.ref.tier,
          err: redactStorageUrisInText(
            err instanceof Error ? err.message : String(err),
          ),
        },
        "Blob holder transfer failed; relying on the TTL backstop",
      );
    }
  }

  /**
   * Awaited variant of {@link acquire} used by the transfer fallback so a
   * failed acquire can be observed synchronously before the release runs.
   */
  private async acquireAwait(value: string): Promise<void> {
    const hold = readEnvelopeHold(value);
    if (!hold) return;
    await this.blobHolders.acquire({
      projectId: hold.ref.projectId,
      hash: hold.ref.hash,
      slotId: hold.token,
    });
  }
}

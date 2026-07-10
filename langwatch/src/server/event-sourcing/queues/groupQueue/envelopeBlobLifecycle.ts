import { Cluster, type Redis as IORedis } from "ioredis";

import { createLogger } from "../../../../utils/logger/server";
import { tenantIdFromGroupId } from "../../../observability/tenantRateTracker";
import {
  type ProjectStorageDestination,
  redactStorageUrisInText,
} from "../../../stored-objects/project-storage-destination";
import { createTenantId, type TenantId } from "../../domain/tenantId";
import { S3_RECLAIM_GRACE_MS } from "./blobConstants";
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
import {
  type BlobRef,
  type ObjectStore,
  TieredBlobStore,
} from "./tieredBlobStore";

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
  private readonly s3ReclaimGraceMs: number;

  constructor({
    redis,
    queueName,
    objectStoreFor,
    resolveStorageDestination,
    writesEnabled,
    s3ReclaimGraceMs,
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
    /**
     * Grace between an s3 reclaim decision and its DeleteObject; see
     * {@link S3_RECLAIM_GRACE_MS}. Injectable so tests don't wait wall-clock.
     */
    s3ReclaimGraceMs?: number;
  }) {
    this.queueName = queueName;
    this.writesEnabled = writesEnabled;
    this.s3ReclaimGraceMs = s3ReclaimGraceMs ?? S3_RECLAIM_GRACE_MS;
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
   *
   * The occupancy's hold on the shared blob is registered HERE, awaited, before
   * the blob is written and before the returned value can be staged — so by the
   * time any other job's release can observe this occupancy, its hold is
   * already in the holder set. The fire-and-forget post-stage
   * {@link EnvelopeBlobLifecycle.acquire} is only a TTL refresh on top of this.
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
      acquireHold: ({ projectId, hash, token }) =>
        this.blobHolders.acquire({ projectId, hash, slotId: token }),
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
   * Re-asserts this staged occupancy's hold on its GQ2 blob (no-op for GQ1,
   * inline, and legacy values). The authoritative hold is registered inside
   * {@link encode}, awaited, before the blob is written — content-addressed
   * blobs are shared across jobs, so a hold that only exists after staging
   * leaves a window where another job's release reclaims the blob out from
   * under this one. This post-stage call is an idempotent SADD + TTL refresh
   * for values that were encoded earlier (re-stages, drained-sibling
   * re-stages), and safe to fire-and-forget.
   */
  acquire(value: string): void {
    const hold = readEnvelopeHold(value);
    if (!hold) return;
    void this.blobHolders
      .acquire({
        projectId: hold.ref.projectId,
        hash: hold.ref.hash,
        slotId: hold.token,
      })
      .catch((err: unknown) => {
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
      });
  }

  /**
   * Releases holds for retired staged values: a GQ2 value releases its holder —
   * reclaiming the blob when the last hold drops, deleting an s3 object
   * out-of-band; a legacy GQ1 value deletes its randomUUID blob. Fire-and-forget:
   * the blob TTL is the correctness backstop, so the hot path never waits.
   */
  release({ values, groupId }: { values: string[]; groupId: string }): void {
    const expected = this.projectIdFor(groupId);
    for (const value of values) {
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
          continue;
        }
        void this.blobHolders
          .release({
            projectId: hold.ref.projectId,
            hash: hold.ref.hash,
            tier: hold.ref.tier,
            slotId: hold.token,
          })
          .then((outcome) => {
            if (outcome === "reclaim-s3") {
              return this.reclaimS3(hold.ref, "holder drop");
            }
          })
          .catch((err: unknown) => {
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
          });
        continue;
      }
      if (blobId) {
        void this.blobs.delete({ id: blobId }).catch(() => undefined);
      }
    }
  }

  /**
   * Atomically moves the hold from a retired value to its replacement (retry
   * re-encode or dedup squash): one eval adds the new hold, drops the old, and
   * reclaims the old blob if newly unreferenced — no acquire-then-release gap in
   * which a partial failure could reclaim a live blob (ADR-030 §4). Falls back to
   * ordered acquire+release when either side isn't a GQ2 hold.
   */
  transfer({
    newValue,
    oldValue,
    groupId,
  }: {
    newValue: string;
    oldValue: string;
    groupId: string;
  }): void {
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
      this.release({ values: [oldValue], groupId });
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
      void (async () => {
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
        this.release({ values: [oldValue], groupId });
      })();
      return;
    }
    void this.blobHolders
      .transfer({
        newProjectId: newHold.ref.projectId,
        newHash: newHold.ref.hash,
        newSlotId: newHold.token,
        oldProjectId: oldHold.ref.projectId,
        oldHash: oldHold.ref.hash,
        oldTier: oldHold.ref.tier,
        oldSlotId: oldHold.token,
      })
      .then((outcome) => {
        if (outcome === "reclaim-s3") {
          return this.reclaimS3(oldHold.ref, "transfer");
        }
      })
      .catch((err: unknown) => {
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
      });
  }

  /**
   * Out-of-band s3 reclaim with a grace re-check. The release/transfer eval
   * decided the holder set was empty, but the DeleteObject is a separate
   * network call — a staging elsewhere can re-hold the same content in the gap
   * (its hold is registered before its PUT, so a re-held blob is always
   * rewritten). Wait out the grace, re-check the holder set, and skip the
   * delete when the content is held again: a skipped orphan degrades to the
   * TTL / bucket-lifecycle backstop, never to a deleted live blob.
   */
  private async reclaimS3(ref: BlobRef, edge: string): Promise<void> {
    if (!this.tieredBlobs) return;
    try {
      if (this.s3ReclaimGraceMs > 0) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, this.s3ReclaimGraceMs);
          // Never keep a worker process alive just to finish a best-effort
          // delete; an abandoned reclaim is an orphan for the backstop.
          timer.unref?.();
        });
      }
      if (
        await this.blobHolders.isHeld({
          projectId: ref.projectId,
          hash: ref.hash,
        })
      ) {
        return;
      }
      await this.tieredBlobs.delete(ref);
    } catch (err: unknown) {
      // S3 reclaim failed — the holder is already gone, so no future release
      // will retry this object. Warn AND counter so oncall sees a recurring
      // failure before the bucket-lifecycle backstop kicks in (2026-06-24
      // review).
      gqBlobReclaimS3FailuresTotal.inc({ queue_name: this.queueName });
      logger.warn(
        {
          projectId: ref.projectId,
          blobHash: ref.hash,
          edge,
          err: redactStorageUrisInText(
            err instanceof Error ? err.message : String(err),
          ),
        },
        "S3 blob reclaim failed after holder drop — orphaned until bucket lifecycle sweeps",
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

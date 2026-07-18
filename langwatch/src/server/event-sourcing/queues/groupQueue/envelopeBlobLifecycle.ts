import { createLogger } from "@langwatch/observability";
import { Cluster, type Redis as IORedis } from "ioredis";
import { tenantIdFromGroupId } from "../../../observability/tenantRateTracker";
import { redactStorageUrisInText } from "../../../stored-objects/project-storage-destination";
import { createTenantId, type TenantId } from "../../domain/tenantId";
import { BlobLeases } from "./blobLeases";
import {
  decodeJobEnvelope,
  encodeJobEnvelope,
  isEnvelope,
  readEnvelopeLease,
  readEnvelopeLeaseFromHeader,
  readEnvelopeRetirement,
  splitEnvelope,
} from "./jobEnvelope";
import { hasRedisHashTag } from "./redisHashTag";
import { RedisJobBlobStore } from "./redisJobBlobStore";
import { type ObjectStore, TieredBlobStore } from "./tieredBlobStore";
import type { GroupQueueStorageDestination } from "./groupQueueStorage";

const logger = createLogger("langwatch:event-sourcing:envelope-blob-lifecycle");

/**
 * Owns the GQ2 content-addressed blob lifecycle for a GroupQueue — the tiered
 * store, the renewable leases, and the encode / decode / take / release
 * seams — so the queue processor delegates rather than carrying it inline, and
 * the seams are exercisable without standing up the whole queue. See ADR-030.
 */
export class EnvelopeBlobLifecycle {
  private readonly blobs: RedisJobBlobStore;
  private readonly blobLeases: BlobLeases;
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
    ) => Promise<GroupQueueStorageDestination>;
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
    // Lease transfer and the rolling-deploy compatibility guard touch multiple
    // keys. In cluster mode they must share a slot, which requires the queue
    // hash tag. A single Redis has no slots, so the check is cluster-only.
    if (redis instanceof Cluster && !hasRedisHashTag(queueName)) {
      throw new Error(
        `GroupQueue "${queueName}" needs a Redis hash tag ({...}): the lease ` +
          `evals touch lease and rolling-deploy guard keys, which must ` +
          `share one cluster slot.`,
      );
    }
    this.blobs = new RedisJobBlobStore({ redis, queueName });
    this.blobLeases = new BlobLeases({ redis, queueName });
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
   * the blob store / lease set is a `TenantId` minted here, so a raw string
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
    // the lease holder identity (for the tenant guard + renewal) and routing needed to
    // decode the body. Passing the parsed tuple into decodeJobEnvelope skips a
    // second Buffer.from + JSON.parse (2026-06-24 review).
    const parsed = isEnvelope(value) ? splitEnvelope(value) : undefined;
    const lease = parsed ? readEnvelopeLeaseFromHeader(parsed.header) : null;
    if (lease) {
      // Defense-in-depth: the blob ref's tenant must match the group's tenant.
      // A forged or mis-routed ref must never read another tenant's blob, so
      // refuse before fetching and let the missing-blob fail-safe run (ADR-030 §5).
      const expected = this.projectIdFor(groupId);
      if (lease.ref.projectId !== expected) {
        logger.warn(
          {
            projectId: expected,
            refProjectId: lease.ref.projectId,
            blobHash: lease.ref.hash,
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
    // The decode's GETEX refreshed the blob TTL; renew this holder's lease at the
    // same touch point so live work remains protected while crashed siblings age out.
    if (lease) {
      void this.blobLeases
        .renew({
          projectId: lease.ref.projectId,
          hash: lease.ref.hash,
          holderId: lease.holderId,
          tier: lease.ref.tier,
        })
        .catch((err: unknown) => {
          logger.warn(
            {
              projectId: lease.ref.projectId,
              blobHash: lease.ref.hash,
              err: redactStorageUrisInText(
                err instanceof Error ? err.message : String(err),
              ),
            },
            "Blob lease renewal failed; relying on the blob backstop",
          );
        });
    }
    return decoded;
  }

  /**
   * Renews the lease carried by an in-flight GQ2 envelope. The active-job
   * heartbeat calls this while a handler is running, so a healthy worker keeps
   * its blob live even when one attempt lasts longer than the lease window.
   */
  async renewLease(value: string): Promise<void> {
    const lease = readEnvelopeLease(value);
    if (!lease) return;
    try {
      await this.blobLeases.renew({
        projectId: lease.ref.projectId,
        hash: lease.ref.hash,
        holderId: lease.holderId,
        tier: lease.ref.tier,
      });
    } catch (err) {
      logger.warn(
        {
          projectId: lease.ref.projectId,
          blobHash: lease.ref.hash,
          tier: lease.ref.tier,
          err: redactStorageUrisInText(
            err instanceof Error ? err.message : String(err),
          ),
        },
        "Blob lease heartbeat renewal failed; relying on the blob backstop",
      );
    }
  }

  /**
   * Releases leases for retired staged values. GQ2 release only removes this
   * holder's lease; blobs reclaim lazily through Redis TTL or the durable-store
   * lifecycle sweep. A legacy GQ1 value still deletes its private randomUUID blob. Awaited by
   * the caller (2026-07-11 fix): this was previously fire-and-forget, so a
   * killed worker process could drop a release before it reached Redis,
   * leaving a stale lifecycle entry (or racing a concurrent transfer).
   * Each value's release still degrades to a warn + the TTL backstop rather
   * than throwing — one bad value must not abort the rest of the batch.
   */
  async releaseLease({
    values,
    groupId,
  }: {
    values: string[];
    groupId: string;
  }): Promise<void> {
    const expected = this.projectIdFor(groupId);
    await Promise.all(
      values.map(async (value) => {
        // Single parse per value: lease + GQ1 blobId from one splitEnvelope so a
        // maxBatch=10 coalesced completion doesn't do ~20 redundant Buffer.from +
        // JSON.parse (2026-06-24 review).
        const { lease, blobId } = readEnvelopeRetirement(value);
        if (lease) {
          // Tenant guard: never release a lease whose ref isn't this group's
          // tenant. A mis-routed or forged GQ2 value must not reclaim another
          // tenant's blob on the fail-safe cleanup path (ADR-030 §5).
          if (lease.ref.projectId !== expected) {
            logger.warn(
              {
                projectId: expected,
                refProjectId: lease.ref.projectId,
                blobHash: lease.ref.hash,
                groupId,
              },
              "Skipping blob release for a tenant-mismatched ref",
            );
            return;
          }
          try {
            await this.blobLeases.release({
              projectId: lease.ref.projectId,
              hash: lease.ref.hash,
              holderId: lease.holderId,
            });
          } catch (err) {
            logger.warn(
              {
                projectId: lease.ref.projectId,
                blobHash: lease.ref.hash,
                tier: lease.ref.tier,
                err: redactStorageUrisInText(
                  err instanceof Error ? err.message : String(err),
                ),
              },
              "Blob lease release failed; relying on lease expiry",
            );
          }
          return;
        }
        if (blobId) {
          try {
            await this.blobs.delete({ id: blobId });
          } catch {
            // GQ1 blobs have no shared lifecycle beyond their own TTL;
            // best-effort cleanup only.
          }
        }
      }),
    );
  }

  /**
   * Atomically moves the lease from a retired value to its replacement (retry
   * re-encode or dedup squash): one eval takes the new lease and drops the old.
   * No transfer path deletes blobs. Falls back to
   * ordered take+release when either side isn't a GQ2 lease.
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
  async transferLease({
    newValue,
    oldValue,
    groupId,
  }: {
    newValue: string;
    oldValue: string;
    groupId: string;
  }): Promise<void> {
    const expected = this.projectIdFor(groupId);
    const newLease = readEnvelopeLease(newValue);
    const oldLease = readEnvelopeLease(oldValue);
    // A tenant-mismatched newValue must not acquire a foreign lease (the
    // mirror of the release-side guard). Skip both sides — the guarded release
    // also drops the old lease iff its tenant matches (ADR-030 §5).
    if (newLease && newLease.ref.projectId !== expected) {
      logger.warn(
        {
          projectId: expected,
          refProjectId: newLease.ref.projectId,
          blobHash: newLease.ref.hash,
          groupId,
        },
        "Skipping blob acquire for a tenant-mismatched replacement ref",
      );
      await this.releaseLease({ values: [oldValue], groupId });
      return;
    }
    // Fall back to ordered take+release when either side isn't a GQ2 lease, or
    // when the old ref isn't this group's tenant — the guarded release then
    // skips the foreign lease, leaving it to its TTL.
    //
    // This branch dominates during the GQ1 → GQ2 rollout window: new encodes
    // are GQ2 but in-flight staged values are still GQ1, so `!oldLease` fires
    // on every retry/squash. Take-then-release is ORDERED (not parallel
    // fire-and-forget) so a release-before-acquire race can't drop the old
    // blob before the new lease is recorded.
    if (!newLease || !oldLease || oldLease.ref.projectId !== expected) {
      try {
        await this.takeLeaseOrThrow(newValue);
      } catch (err) {
        logger.warn(
          {
            refProjectId: newLease?.ref.projectId,
            blobHash: newLease?.ref.hash,
            groupId,
            err: err instanceof Error ? err.message : String(err),
          },
          "transfer fallback: acquire failed; skipping release to keep old blob alive under TTL",
        );
        return;
      }
      await this.releaseLease({ values: [oldValue], groupId });
      return;
    }
    try {
      await this.blobLeases.transfer({
        newProjectId: newLease.ref.projectId,
        newHash: newLease.ref.hash,
        newHolderId: newLease.holderId,
        oldProjectId: oldLease.ref.projectId,
        oldHash: oldLease.ref.hash,
        oldHolderId: oldLease.holderId,
      });
    } catch (err) {
      logger.warn(
        {
          projectId: oldLease.ref.projectId,
          blobHash: oldLease.ref.hash,
          tier: oldLease.ref.tier,
          err: redactStorageUrisInText(
            err instanceof Error ? err.message : String(err),
          ),
        },
        "Blob lease transfer failed; relying on the TTL backstop",
      );
    }
  }

  /**
   * Awaited take used by the transfer fallback so a
   * failed acquire can be observed synchronously before the release runs.
   */
  private async takeLeaseOrThrow(value: string): Promise<void> {
    const lease = readEnvelopeLease(value);
    if (!lease) return;
    await this.blobLeases.take({
      projectId: lease.ref.projectId,
      hash: lease.ref.hash,
      holderId: lease.holderId,
    });
  }
}

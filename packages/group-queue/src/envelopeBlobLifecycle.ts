import { createLogger } from "@langwatch/observability";
import { Cluster, type Redis as IORedis } from "ioredis";
import { BlobLeases } from "./blobLeases";
import {
  decodeJobEnvelope,
  encodeJobEnvelope,
  isEnvelope,
  readEnvelopeLease,
  readEnvelopeLeaseFromHeader,
  readEnvelopeRetirement,
  readEnvelopeTieredRefFromHeader,
  splitEnvelope,
} from "./jobEnvelope";
import { gqBlobReleaseGraceTotal } from "./metrics";
import { hasRedisHashTag } from "./redisHashTag";
import { RedisJobBlobStore } from "./redisJobBlobStore";
import { type ObjectStore, TieredBlobStore } from "./tieredBlobStore";
import {
  createTenantId,
  type ProjectStorageDestination,
  redactStorageUrisInText,
  type TenantId,
  tenantIdFromGroupId,
} from "./storage";

const logger = createLogger("langwatch:group-queue:envelope-blob-lifecycle");

/**
 * Owns the content-addressed blob lifecycle for a GroupQueue — the tiered
 * store, the renewable leases, and the encode / decode / take / release
 * seams — so the queue processor delegates rather than carrying it inline, and
 * the seams are exercisable without standing up the whole queue. See ADR-029.
 */
export class EnvelopeBlobLifecycle {
  private readonly blobs: RedisJobBlobStore;
  private readonly blobLeases: BlobLeases;
  private readonly tieredBlobs: TieredBlobStore;
  private readonly queueName: string;
  private readonly compression: "gzip" | "zstd";
  private readonly payloadCodec: "json" | "msgpack";

  constructor({
    redis,
    queueName,
    objectStoreFor,
    resolveStorageDestination,
    compression = "gzip",
    payloadCodec = "json",
  }: {
    redis: IORedis | Cluster;
    queueName: string;
    objectStoreFor?: (projectId: string) => ObjectStore;
    resolveStorageDestination?: (projectId: string) => Promise<ProjectStorageDestination>;
    compression?: "gzip" | "zstd";
    payloadCodec?: "json" | "msgpack";
  }) {
    this.queueName = queueName;
    this.compression = compression;
    this.payloadCodec = payloadCodec;
    // Lease transfer and the holder guard touch multiple
    // keys. In cluster mode they must share a slot, which requires the queue
    // hash tag. A single Redis has no slots, so the check is cluster-only.
    if (redis instanceof Cluster && !hasRedisHashTag(queueName)) {
      throw new Error(
        `GroupQueue "${queueName}" needs a Redis hash tag ({...}): the lease ` +
          `evals touch lease and holder-guard keys, which must ` +
          `share one cluster slot.`,
      );
    }
    this.blobs = new RedisJobBlobStore({ redis, queueName });
    this.blobLeases = new BlobLeases({ redis, queueName });
    this.tieredBlobs = new TieredBlobStore({
      redisBlobs: this.blobs,
      objectStoreFor:
        objectStoreFor ??
        (() => {
          throw new Error("No durable object store was configured for Group Queue");
        }),
      resolveDestination:
        resolveStorageDestination ??
        (async () => {
          throw new Error("No durable storage destination resolver was configured for Group Queue");
        }),
      queueName,
      logger,
    });
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
      tieredBlobs: this.tieredBlobs,
      projectId: this.projectIdFor(groupId),
      compression: this.compression,
      payloadCodec: this.payloadCodec,
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
    // Guard the REF, not the lease. A lease additionally requires `header.h`,
    // so keying the tenant check off it let an envelope carrying a valid
    // cross-tenant ref and no holder id skip the guard entirely and still be
    // fetched by decodeJobEnvelope, which has no tenant check of its own.
    const tieredRef = parsed ? readEnvelopeTieredRefFromHeader(parsed.header) : null;
    if (tieredRef) {
      // Defense-in-depth: the blob ref's tenant must match the group's tenant.
      // A forged or mis-routed ref must never read another tenant's blob, so
      // refuse before fetching and let the missing-blob fail-safe run (ADR-029).
      // An untenanted group cannot validate a tiered ref at all, so it is
      // refused rather than waved through on an undefined === undefined match.
      const expected = this.projectIdFor(groupId);
      if (!expected || tieredRef.projectId !== expected) {
        logger.warn(
          {
            projectId: expected,
            refProjectId: tieredRef.projectId,
            blobHash: tieredRef.hash,
            groupId,
          },
          "Blob ref tenant mismatch; refusing cross-tenant read",
        );
        throw new Error("Blob ref tenant mismatch");
      }
    }
    const decoded = await decodeJobEnvelope({
      value,
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
              err: redactStorageUrisInText(err instanceof Error ? err.message : String(err)),
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
          err: redactStorageUrisInText(err instanceof Error ? err.message : String(err)),
        },
        "Blob lease heartbeat renewal failed; relying on the blob backstop",
      );
    }
  }

  /**
   * Releases leases for retired staged values. Release only removes this
   * holder's lease; blobs reclaim lazily through Redis TTL or the durable-store
   * lifecycle sweep. Awaited by
   * the caller (2026-07-11 fix): this was previously fire-and-forget, so a
   * killed worker process could drop a release before it reached Redis,
   * leaving a stale lifecycle entry (or racing a concurrent transfer).
   * Each value's release still degrades to a warn + the TTL backstop rather
   * than throwing — one bad value must not abort the rest of the batch.
   */
  async releaseLease({ values, groupId }: { values: string[]; groupId: string }): Promise<void> {
    const expected = this.projectIdFor(groupId);
    await Promise.all(
      values.map(async (value) => {
        const { lease } = readEnvelopeRetirement(value);
        if (lease) {
          // Tenant guard: never release a lease whose ref isn't this group's
          // tenant. A mis-routed or forged GQ2 value must not reclaim another
          // tenant's blob on the fail-safe cleanup path (ADR-029).
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
            const graced = await this.blobLeases.release({
              projectId: lease.ref.projectId,
              hash: lease.ref.hash,
              holderId: lease.holderId,
              tier: lease.ref.tier,
            });
            if (graced) {
              gqBlobReleaseGraceTotal.inc({
                queue_name: this.queueName,
                tier: lease.ref.tier,
              });
            }
          } catch (err) {
            logger.warn(
              {
                projectId: lease.ref.projectId,
                blobHash: lease.ref.hash,
                tier: lease.ref.tier,
                err: redactStorageUrisInText(err instanceof Error ? err.message : String(err)),
              },
              "Blob lease release failed; relying on lease expiry",
            );
          }
          return;
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
    // mirror of the release-side guard). Skip the foreign replacement; the
    // guarded release retires the old lease only when its tenant matches.
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
    // Take-then-release is ordered so a release-before-acquire race cannot
    // drop the old blob before the new lease is recorded.
    if (!newLease || !oldLease || oldLease.ref.projectId !== expected) {
      try {
        await this.takeLeaseOrThrow(newValue);
      } catch (err) {
        logger.warn(
          {
            refProjectId: newLease?.ref.projectId,
            blobHash: newLease?.ref.hash,
            groupId,
            err: redactStorageUrisInText(err instanceof Error ? err.message : String(err)),
          },
          "transfer fallback: acquire failed; skipping release to keep old blob alive under TTL",
        );
        return;
      }
      await this.releaseLease({ values: [oldValue], groupId });
      return;
    }
    try {
      const graced = await this.blobLeases.transfer({
        newProjectId: newLease.ref.projectId,
        newHash: newLease.ref.hash,
        newHolderId: newLease.holderId,
        oldProjectId: oldLease.ref.projectId,
        oldHash: oldLease.ref.hash,
        oldHolderId: oldLease.holderId,
        oldTier: oldLease.ref.tier,
      });
      if (graced) {
        gqBlobReleaseGraceTotal.inc({
          queue_name: this.queueName,
          tier: oldLease.ref.tier,
        });
      }
    } catch (err) {
      logger.warn(
        {
          projectId: oldLease.ref.projectId,
          blobHash: oldLease.ref.hash,
          tier: oldLease.ref.tier,
          err: redactStorageUrisInText(err instanceof Error ? err.message : String(err)),
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
      tier: lease.ref.tier,
    });
  }
}

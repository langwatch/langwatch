import { createLogger } from "@langwatch/observability";
import { Cluster, type Redis as IORedis } from "ioredis";
import { tenantIdFromGroupId } from "../../../observability/tenantRateTracker";
import type { ProjectStorageDestination } from "../../../stored-objects/project-storage-destination";
import { createTenantId, type TenantId } from "../../domain/tenantId";
import {
  decodeJobEnvelope,
  encodeJobEnvelope,
  type EnvelopeHeader,
  isEnvelope,
  splitEnvelope,
} from "./jobEnvelope";
import { hasRedisHashTag } from "./redisHashTag";
import { RedisJobBlobStore } from "./redisJobBlobStore";
import { type ObjectStore, TieredBlobStore } from "./tieredBlobStore";

const logger = createLogger("langwatch:event-sourcing:envelope-blob-lifecycle");

/**
 * Owns the GQ2 blob lifecycle for a GroupQueue — the tiered store and the
 * encode / decode seams — so the queue processor delegates rather than
 * carrying it inline, and the seams are exercisable without standing up the
 * whole queue. See ADR-029/030 for the store and ADR-046 for the lease model.
 *
 * There is deliberately no acquire/release/transfer surface here any more:
 * blob lifetime is a lease (set at PUT, renewed on read, extended by the
 * block/DLQ Lua), so the lifecycle has nothing to bookkeep at completion,
 * retry, or squash time.
 */
export class EnvelopeBlobLifecycle {
  private readonly blobs: RedisJobBlobStore;
  private readonly tieredBlobs?: TieredBlobStore;
  private readonly queueName: string;

  constructor({
    redis,
    queueName,
    objectStoreFor,
    resolveStorageDestination,
  }: {
    redis: IORedis | Cluster;
    queueName: string;
    objectStoreFor?: (projectId: string) => ObjectStore;
    resolveStorageDestination?: (
      projectId: string,
    ) => Promise<ProjectStorageDestination>;
  }) {
    this.queueName = queueName;
    // The block/DLQ lease-extension evals touch the group data hash and the
    // blob keys together; in cluster mode they must share a slot, which
    // requires the queue name to carry a hash tag. Fail fast rather than
    // CROSSSLOT-leak silently at runtime (ADR-030 §6). A single Redis has no
    // slots, so the check is cluster-only.
    if (redis instanceof Cluster && !hasRedisHashTag(queueName)) {
      throw new Error(
        `GroupQueue "${queueName}" needs a Redis hash tag ({...}): the ` +
          `lease-extension evals touch the group hash and blob keys, which ` +
          `must share one cluster slot.`,
      );
    }
    this.blobs = new RedisJobBlobStore({ redis, queueName });
    // The tiered store is active only when the composition root supplies an
    // object store + destination resolver; otherwise encode falls back to an
    // inline GQ2 body (loud — see encodeJobEnvelope).
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
   * the blob store is a `TenantId` minted here, so a raw string can't be used
   * to namespace a blob (tenant-isolation safety at the type level).
   */
  private projectIdFor(groupId: string): TenantId | undefined {
    const tenantId = tenantIdFromGroupId(groupId);
    return tenantId ? createTenantId(tenantId) : undefined;
  }

  /**
   * Encodes a job payload into a staged envelope, offloading a large body to the
   * content-addressed tiered store under the group's tenant namespace. The PUT
   * sets the blob's lease (ADR-046).
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
      queueName: this.queueName,
      logger,
    });
  }

  /**
   * Decodes a staged envelope back into the job payload, resolving any
   * offloaded blob. The worker-path read renews the blob's lease (GETEX inside
   * the tiered store).
   */
  async decode({
    value,
    groupId,
  }: {
    value: string;
    groupId: string;
  }): Promise<Record<string, unknown>> {
    // Parse the envelope ONCE here on the hot path; the header carries both
    // the blob ref (for the tenant guard) and the routing needed to decode the
    // body. Passing the parsed tuple into decodeJobEnvelope skips a second
    // Buffer.from + JSON.parse (2026-06-24 review).
    const parsed: { header: EnvelopeHeader; body: string } | undefined =
      isEnvelope(value) ? splitEnvelope(value) : undefined;
    const ref = parsed?.header.ref;
    if (ref) {
      // Defense-in-depth: the blob ref's tenant must match the group's tenant.
      // A forged or mis-routed ref must never read another tenant's blob, so
      // refuse before fetching and let the missing-blob fail-safe run (ADR-030 §5).
      const expected = this.projectIdFor(groupId);
      if (ref.projectId !== expected) {
        logger.warn(
          {
            projectId: expected,
            refProjectId: ref.projectId,
            blobHash: ref.hash,
            groupId,
          },
          "Blob ref tenant mismatch; refusing cross-tenant read",
        );
        throw new Error("Blob ref tenant mismatch");
      }
    }
    return decodeJobEnvelope({
      value,
      blobs: this.blobs,
      tieredBlobs: this.tieredBlobs,
      parsed,
    });
  }
}

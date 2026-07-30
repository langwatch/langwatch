import { createLogger } from "@langwatch/observability";
import { Cluster, type Redis as IORedis } from "ioredis";
import { tenantIdFromGroupId } from "../../../observability/tenantRateTracker";
import {
  type ProjectStorageDestination,
  redactStorageUrisInText,
} from "../../../stored-objects/project-storage-destination";
import { createTenantId, type TenantId } from "../../domain/tenantId";
import {
  BLOB_BACKSTOP_TTL_SECONDS,
  BLOB_RELEASE_GRACE_TTL_SECONDS,
} from "./blobConstants";
import { BlobLeases } from "./blobLeases";
import {
  decodeJobEnvelope,
  encodeJobEnvelope,
  isEnvelope,
  readEnvelopeDescriptor,
  readEnvelopeLease,
  readEnvelopeLeaseFromHeader,
  readEnvelopeRetirement,
  readEnvelopeTieredRefFromHeader,
  splitEnvelope,
} from "./jobEnvelope";
import { gqBlobReleaseGraceTotal } from "./metrics";
import { hasRedisHashTag } from "./redisHashTag";
import { RedisJobBlobStore } from "./redisJobBlobStore";
// Type-only: the dead-letter entry's schema lives with its writer
// (`GroupStagingScripts.writeJobToDlq`), and a type import adds no runtime edge,
// so nothing that imports the scripts module pulls this one in.
import type { DlqBodyPreservation } from "./scripts";
import { type ObjectStore, TieredBlobStore } from "./tieredBlobStore";

const logger = createLogger("langwatch:event-sourcing:envelope-blob-lifecycle");

/**
 * How long the body behind an `unextended` dead-letter entry really stays
 * readable — the number an operator acts on when a preserve-for-DLQ fails.
 *
 * It is a property of the CALLER, not of the failure: a caller that releases its
 * lease next drops the blob onto the release grace window, while one that
 * releases nothing leaves it on the routine backstop. Those differ by orders of
 * magnitude, so a single hardcoded figure is necessarily wrong at one of the two
 * call sites.
 *
 * Both figures are derived from the TTL constants rather than written into prose,
 * so the window quoted to oncall cannot drift away from the expiry that will
 * actually happen.
 */
function unextendedRecoveryWindow({
  releasesLeaseAfter,
}: {
  releasesLeaseAfter: boolean;
}): { seconds: number; description: string } {
  if (releasesLeaseAfter) {
    const hours = Math.round(BLOB_RELEASE_GRACE_TTL_SECONDS / 3600);
    return {
      seconds: BLOB_RELEASE_GRACE_TTL_SECONDS,
      description: `the release grace window (~${hours}h, counting from the lease release this drop performs next)`,
    };
  }
  const days = Math.round(BLOB_BACKSTOP_TTL_SECONDS / (24 * 3600));
  return {
    seconds: BLOB_BACKSTOP_TTL_SECONDS,
    description: `the routine blob backstop (~${days}d, because this drop releases no lease)`,
  };
}

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
    // Guard the REF, not the lease. A lease additionally requires `header.h`,
    // so keying the tenant check off it let an envelope carrying a valid
    // cross-tenant ref and no holder id skip the guard entirely and still be
    // fetched by decodeJobEnvelope, which has no tenant check of its own.
    const tieredRef = parsed
      ? readEnvelopeTieredRefFromHeader(parsed.header)
      : null;
    if (tieredRef) {
      // Defense-in-depth: the blob ref's tenant must match the group's tenant.
      // A forged or mis-routed ref must never read another tenant's blob, so
      // refuse before fetching and let the missing-blob fail-safe run (ADR-030 §5).
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
   * Push a still-referenced blob's lifetime out to at least the dead-letter
   * quarantine window (#719/#720), and report whether that actually happened.
   *
   * A body-present drop is preserved in the dead-letter for ~7 days while the
   * blob it references is on a far shorter clock — so without this the
   * dead-letter outlives the blob and a drain recovers an envelope pointing at
   * nothing. s3-tier objects have no redis TTL and are left to the bucket
   * lifecycle (ADR-029), so for that tier only the lease bookkeeping is extended.
   *
   * Uses {@link BlobLeases.holdForDlq}, which records the dead-letter as a real
   * holder for the window. `renew`/`take` cannot serve: they only extend the
   * *logical* lease deadline, since the Lua script's hardcoded
   * `BLOB_LEASE_SET_TTL_SECONDS`/`BLOB_BACKSTOP_TTL_SECONDS` still cap the
   * *physical* Redis TTL regardless of the ttlSeconds passed to them. A bare TTL
   * bump cannot serve either: both the release-time grace helper and the
   * maintenance sweep reclaim an *unleased* blob back to
   * `BLOB_RELEASE_GRACE_TTL_SECONDS` (1 hour) — and `dropStagedJob`'s own
   * `releaseLease()` runs immediately after this call, so that reclaim is not a
   * hypothetical, it is the next statement.
   *
   * That is also the FAILURE window, and WHICH window it is belongs to the
   * caller, not to this method: when this returns `unextended` and the caller
   * releases its lease next, the blob is not sitting on the routine backstop at
   * all — it is heading for the grace window as soon as that release lands, an
   * hour rather than days. The DRAINED-sibling caller is the one exception, and
   * only because it releases nothing: an unextended blob there keeps the routine
   * backstop — longer than an hour, still short of the quarantine window. That is
   * what `releasesLeaseAfter` exists to tell the warn below, so the figure oncall
   * reads is the one they actually have (see {@link unextendedRecoveryWindow}).
   *
   * Best-effort — never throws, never blocks the drop. The return value is how
   * the caller records the true state on the dead-letter entry
   * ({@link DlqBodyPreservation}) instead of stamping every entry as preserved.
   */
  async preserveForDlq({
    value,
    groupId,
    ttlSeconds,
    releasesLeaseAfter = true,
  }: {
    value: string;
    groupId: string;
    ttlSeconds: number;
    /**
     * Whether the caller releases this value's blob lease immediately after this
     * returns — the only thing that decides how long an unextended body survives.
     *
     * Defaults to `true`, the shorter window, deliberately: a caller that forgets
     * to say then understates the time oncall has rather than overstating it. The
     * one caller that releases nothing (`GroupQueueProcessor.deadLetterDrainedValue`,
     * whose value has already left staging) passes `false` explicitly.
     */
    releasesLeaseAfter?: boolean;
  }): Promise<DlqBodyPreservation> {
    const { lease, blobId } = readEnvelopeRetirement(value);
    try {
      if (lease) {
        // Tenant guard (ADR-030 §5), matching decode(): derive the ref's tenant
        // from untrusted envelope data, so a forged or mis-routed ref must not
        // extend another tenant's blob lifetime. The `!expected` arm is not
        // belt-and-braces — an UNTENANTED groupId makes projectIdFor return
        // undefined, and without it a forged ref whose projectId is also missing
        // passes on an `undefined === undefined` match. decode() refuses that case
        // explicitly; this must too, or the guard is weaker than the one it cites.
        const expected = this.projectIdFor(groupId);
        if (!expected || lease.ref.projectId !== expected) {
          logger.warn(
            { groupId, refProjectId: lease.ref.projectId },
            "Skipping blob TTL preserve-for-DLQ for a tenant-mismatched ref",
          );
          return "unextended";
        }
        await this.blobLeases.holdForDlq({
          projectId: lease.ref.projectId,
          hash: lease.ref.hash,
          tier: lease.ref.tier,
          ttlSeconds,
        });
        return "extended";
      }
      if (blobId) {
        // GQ1: extend the standalone blob.
        await this.blobs.refreshTtl({ id: blobId, ttlSeconds });
        return "extended";
      }
      return this.classifyUnreferencedForDlq({ value, groupId });
    } catch (err) {
      const recoveryWindow = unextendedRecoveryWindow({ releasesLeaseAfter });
      logger.warn(
        {
          groupId,
          // Structured twin of the clause in the message, from the same value, so
          // an alert threshold and the sentence oncall reads cannot disagree.
          recoveryWindowSeconds: recoveryWindow.seconds,
          error: redactStorageUrisInText(
            err instanceof Error ? err.message : String(err),
          ),
        },
        `Blob TTL preserve-for-DLQ failed — the dead-letter entry will outlive the body it references unless it is drained within ${recoveryWindow.description}`,
      );
      return "unextended";
    }
  }

  /**
   * Classify a value {@link readEnvelopeRetirement} found no blob reference on.
   *
   * Two very different states land here and conflating them would either cry wolf
   * on the common case or leave the real one silent — which is what it did:
   *
   * - The body travels INSIDE the staged value (`e:"j"`/`e:"gz"`, or a legacy
   *   pre-envelope raw value). The dead-letter entry stores that value verbatim,
   *   so there is nothing to extend and nothing at risk. Most drops are this, and
   *   warning on them would bury the case below.
   * - The envelope CLAIMS an offloaded body (`e:"ref"/"redis"/"s3"`) but yields no
   *   usable reference, or will not split at all (`malformed_envelope`). Then a
   *   reference we cannot read is the only thing between the entry and its bytes,
   *   so nothing was extended — and this path used to `return` with no log line at
   *   all, the one gap in `preserveForDlq` with no signal whatsoever (review #5853).
   *
   * A ref carrying no holder id lands here too and is reported honestly rather
   * than held: `holdForDlq` needs only the ref, so a hold is technically
   * reachable, but a tiered envelope without `h` is the forged/tampered shape the
   * decode guard exists for (ADR-030 §5) and quarantining bytes on its word is a
   * decision for its own change, not a side effect of a log fix.
   */
  private classifyUnreferencedForDlq({
    value,
    groupId,
  }: {
    value: string;
    groupId: string;
  }): DlqBodyPreservation {
    const { format } = readEnvelopeDescriptor(value);
    if (!isEnvelope(value) || format === "j" || format === "gz") {
      return "inline";
    }
    logger.warn(
      { groupId, envelopeFormat: format },
      "Dead-lettering a value whose offloaded body carries no usable reference — nothing was extended, so a drain of this entry may find the body already gone",
    );
    return "unextended";
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
            err: redactStorageUrisInText(
              err instanceof Error ? err.message : String(err),
            ),
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
      tier: lease.ref.tier,
    });
  }
}

import { randomUUID } from "node:crypto";
import type {
  BlobSpool,
  ClaimedBatch,
  ClaimRequest,
  Job,
  JobHeader,
  LaneQueue,
  Lease,
  StagedJob,
} from "@langwatch/event-sourcing";
import { parseGroupKey, renderGroupKey } from "@langwatch/event-sourcing";
import type Redis from "ioredis";
import { CachedLuaScript } from "./cachedLuaScript";
import { LANE_REGISTRY_KEY, laneKeys, tenantInFlightKey } from "./laneKeys";
import {
  PARK_LUA,
  RETRY_LUA,
  SETTLE_LUA,
  STAGE_LUA,
  TRY_CLAIM_LUA,
} from "./lua";

/** Bodies at or under this stay inline in the job's own hash field; larger
 * ones are offloaded to the spool and referenced by `header.blobRef`
 * (ADR-108 decision 9 — "the body lives inline when small, spooled when
 * not" is this queue's own call, not the caller's). */
export const DEFAULT_INLINE_BODY_THRESHOLD_BYTES = 8 * 1024;

export interface RedisLaneQueueOptions {
  readonly inlineBodyThresholdBytes?: number;
  /** A tenant already holding this many leased lanes has its other lanes
   * skipped by `claim`, without stopping the scan for other tenants (ADR-108
   * decision 5). `0` (the default) disables it — noisy-neighbour protection
   * is opt-in, since most deployments run one tenant per lane anyway and the
   * fuller cross-lane-kind policy belongs to scheduler.ts. */
  readonly tenantSoftCap?: number;
}

type StagedHeaderFields = Omit<JobHeader, "sequence" | "attempt">;

function headerFieldsFor(
  job: StagedJob,
  blobRef: string | undefined,
): StagedHeaderFields {
  return {
    tenantId: job.descriptor.tenantId,
    lane: job.descriptor.lane,
    scopeParts:
      job.descriptor.scope.kind === "partition"
        ? job.descriptor.scope.parts
        : [],
    aggregateId: job.aggregateId,
    eventType: job.eventType,
    eventId: job.eventId,
    costBytes: job.costBytes,
    ...(blobRef !== undefined ? { blobRef } : {}),
  };
}

/** The Redis implementation of `LaneQueue` (ADR-108 decision 4): one sorted
 * set per lane, keyed by `renderGroupKey`, with sequence assignment and
 * insertion in one Lua step. Composes `spool` for the inline/offload split —
 * pass the same instance also given to the consumer, so a `blobRef` staged
 * here resolves for whoever later decodes the job. */
export function redisLaneQueue(
  redis: Redis,
  spool: BlobSpool,
  options: RedisLaneQueueOptions = {},
): LaneQueue {
  const inlineBodyThresholdBytes =
    options.inlineBodyThresholdBytes ?? DEFAULT_INLINE_BODY_THRESHOLD_BYTES;
  const tenantSoftCap = options.tenantSoftCap ?? 0;
  /** Where the next claim's lane scan starts, so no lane is always first. */
  let scanCursor = 0;
  const stageScript = new CachedLuaScript(STAGE_LUA);
  const claimScript = new CachedLuaScript(TRY_CLAIM_LUA);
  const settleScript = new CachedLuaScript(SETTLE_LUA);
  const retryScript = new CachedLuaScript(RETRY_LUA);
  const parkScript = new CachedLuaScript(PARK_LUA);

  // Self-healing by construction: a slot's score is the SAME lease expiry the
  // lane itself carries, so a worker that dies mid-job ages out of the count
  // without any explicit cleanup — a stuck tenant cannot stay "at cap"
  // forever on dead leases (mirrors the lane lease's own reclaim story).
  async function tenantInFlightCount(
    tenantId: string,
    now: number,
  ): Promise<number> {
    const key = tenantInFlightKey(tenantId);
    await redis.zremrangebyscore(key, "-inf", now);
    return redis.zcard(key);
  }

  async function releaseTenantSlot(groupKey: string): Promise<void> {
    if (tenantSoftCap <= 0) return;
    const { tenantId } = parseGroupKey(groupKey);
    await redis.zrem(tenantInFlightKey(tenantId), groupKey);
  }

  return {
    async stage(jobs) {
      const byLane = new Map<string, StagedJob[]>();
      for (const job of jobs) {
        const groupKey = renderGroupKey(job.descriptor);
        const list = byLane.get(groupKey);
        if (list) list.push(job);
        else byLane.set(groupKey, [job]);
      }

      for (const [groupKey, laneJobs] of byLane) {
        const keys = laneKeys(groupKey);
        await redis.sadd(LANE_REGISTRY_KEY, groupKey);

        const encoded = await Promise.all(
          laneJobs.map(async (job) => {
            const offload =
              Buffer.byteLength(job.body) > inlineBodyThresholdBytes;
            const blobRef = offload
              ? await spool.put(job.descriptor.tenantId, job.body)
              : undefined;
            const headerJson = JSON.stringify(headerFieldsFor(job, blobRef));
            return [job.orderingKey, headerJson, offload ? "" : job.body];
          }),
        );

        await stageScript.run(
          redis,
          4,
          keys.z,
          keys.h,
          keys.b,
          keys.seq,
          JSON.stringify(encoded),
        );
      }
    },

    async claim(request: ClaimRequest): Promise<ClaimedBatch | null> {
      const now = Date.now();
      const token = randomUUID();
      const registered = await redis.smembers(LANE_REGISTRY_KEY);

      // Rotate where the scan starts. `smembers` returns a stable-ish order, so
      // scanning from 0 every time serves whichever lane sorts early and lets a
      // tenant with many lanes crowd out one with few, within its cap.
      const start =
        registered.length === 0 ? 0 : scanCursor++ % registered.length;
      const candidates = [
        ...registered.slice(start),
        ...registered.slice(0, start),
      ];

      for (const groupKey of candidates) {
        if (tenantSoftCap > 0) {
          const { tenantId } = parseGroupKey(groupKey);
          const inFlight = await tenantInFlightCount(tenantId, now);
          if (inFlight >= tenantSoftCap) continue; // noisy-neighbour: skip, keep scanning other tenants
        }

        const keys = laneKeys(groupKey);
        const result = (await claimScript.run(
          redis,
          6,
          keys.z,
          keys.h,
          keys.b,
          keys.lease,
          keys.ready,
          keys.parked,
          String(now),
          String(request.maxJobs),
          String(request.maxBytes),
          String(request.leaseMs),
          token,
        )) as readonly string[] | null;
        if (result === null) continue;

        const jobs: Job[] = [];
        for (let i = 0; i < result.length; i += 2) {
          const headerJson = result[i];
          if (headerJson === undefined) continue;
          jobs.push({
            header: JSON.parse(headerJson) as JobHeader,
            body: result[i + 1] ?? "",
          });
        }
        const first = jobs[0];
        if (first === undefined) continue;

        if (tenantSoftCap > 0) {
          await redis.zadd(
            tenantInFlightKey(first.header.tenantId),
            now + request.leaseMs,
            groupKey,
          );
        }

        return {
          lease: { groupKey, token },
          lane: first.header.lane,
          tenantId: first.header.tenantId,
          jobs,
        };
      }
      return null;
    },

    async settle(lease: Lease) {
      const keys = laneKeys(lease.groupKey);
      await settleScript.run(
        redis,
        4,
        keys.z,
        keys.h,
        keys.b,
        keys.lease,
        lease.token,
      );
      await releaseTenantSlot(lease.groupKey);
    },

    async retry(lease: Lease, afterMs: number) {
      const keys = laneKeys(lease.groupKey);
      await retryScript.run(
        redis,
        3,
        keys.h,
        keys.lease,
        keys.ready,
        lease.token,
        String(afterMs),
        String(Date.now()),
      );
      await releaseTenantSlot(lease.groupKey);
    },

    async park(lease: Lease, reason: string) {
      const keys = laneKeys(lease.groupKey);
      await parkScript.run(
        redis,
        2,
        keys.lease,
        keys.parked,
        lease.token,
        reason,
      );
      await releaseTenantSlot(lease.groupKey);
    },

    async depth(groupKey: string) {
      const keys = laneKeys(groupKey);
      return redis.zcard(keys.z);
    },
  };
}

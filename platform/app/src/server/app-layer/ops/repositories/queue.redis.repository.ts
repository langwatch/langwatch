import type { JobHeader, Lane } from "@langwatch/event-sourcing";
import { parseGroupKey } from "@langwatch/event-sourcing";
import {
  CachedLuaScript,
  LANE_REGISTRY_KEY,
  laneKeys,
} from "@langwatch/groupqueue";
import { createLogger } from "@langwatch/observability";
import type { Cluster, Redis as IORedis } from "ioredis";
import { normalizeErrorMessage } from "../normalize-error-message";
import type { ErrorCluster, LaneInfo, LaneKindInfo } from "../types";
import type {
  JobEntry,
  ParkedSummary,
  QueueRepository,
} from "./queue.repository";

const logger = createLogger("langwatch:ops:queue-redis-repository");

/**
 * Deletes every key belonging to one lane and drops it from the registry.
 *
 * All seven lane keys share the group key's hash tag, so they are one slot; the
 * registry is not tagged, but it is only ever touched by single-key commands,
 * which is what keeps this safe on a cluster. Returns the jobs dropped.
 */
const DRAIN_LANE_LUA = `
local dropped = redis.call("ZCARD", KEYS[1])
redis.call("DEL", KEYS[1], KEYS[2], KEYS[3], KEYS[4], KEYS[5], KEYS[6], KEYS[7])
redis.call("SREM", KEYS[8], ARGV[1])
return dropped
`;

const drainLaneScript = new CachedLuaScript(DRAIN_LANE_LUA);

/** How many lanes one operator read may describe. The registry is append-only
 * — `stage` adds and nothing removes — so it outlives the lanes in it. */
const SCAN_LANE_CAP = 5_000;

const SSCAN_BATCH = 500;

/** Enough clusters to see the shape of an incident without paging. */
const SUMMARY_TOP_N = 20;

interface LaneRef {
  laneId: string;
  tenantId: string;
  laneKind: string;
  laneName: string | null;
}

function parseLane(laneId: string): LaneRef | null {
  try {
    const key = parseGroupKey(laneId);
    return {
      laneId,
      tenantId: key.tenantId,
      laneKind: key.lane.kind,
      laneName: key.lane.name ?? null,
    };
  } catch {
    // A member the current build cannot parse is reported as absent rather
    // than throwing: one malformed key must not blank the whole console.
    logger.warn({ laneId }, "Skipping unparseable lane key");
    return null;
  }
}

/** Every lane kind, so the console lists a kind before anything is staged into it. */
const LANE_KINDS: readonly Lane["kind"][] = [
  "command",
  "fold",
  "map",
  "subscriber",
  "processManager",
  "job",
];

function parseHeader(json: string | null | undefined): JobHeader | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as JobHeader;
  } catch {
    return null;
  }
}

/** `ZRANGE … WITHSCORES` and `HMGET` both answer as flat arrays; the value
 * this file wants from either is the second element. */
function secondElement(reply: unknown): number {
  return Array.isArray(reply) ? Number(reply[1]) : Number.NaN;
}

function finiteOrNull(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

function laterThan(value: number, now: number): boolean {
  return Number.isFinite(value) && value > now;
}

/** Lanes parked for the same reason are one row; a few lane ids per row are
 * enough to act on without turning the summary into the listing. */
const CLUSTER_SAMPLE_LANES = 5;

function cluster(
  clusters: Map<string, ErrorCluster>,
  ref: LaneRef,
  reason: string,
): void {
  const normalizedMessage = normalizeErrorMessage(reason);
  const key = `${ref.laneKind}:${normalizedMessage}`;
  const existing = clusters.get(key);
  if (!existing) {
    clusters.set(key, {
      normalizedMessage,
      sampleMessage: reason,
      count: 1,
      laneKind: ref.laneKind,
      sampleLaneIds: [ref.laneId],
    });
    return;
  }
  existing.count += 1;
  if (existing.sampleLaneIds.length < CLUSTER_SAMPLE_LANES) {
    existing.sampleLaneIds.push(ref.laneId);
  }
}

function highestAttempt(headers: unknown): number {
  if (!Array.isArray(headers)) return 0;
  return (headers as string[]).reduce((max, json) => {
    const header = parseHeader(json);
    return header ? Math.max(max, header.attempt) : max;
  }, 0);
}

export class QueueRedisRepository implements QueueRepository {
  constructor(private readonly redis: IORedis | Cluster) {}

  async discoverLaneKinds(): Promise<string[]> {
    const kinds = new Set<string>();
    for (const lane of await this.registeredLanes()) kinds.add(lane.laneKind);
    return LANE_KINDS.filter((kind) => kinds.has(kind));
  }

  /** The registry, capped. `stage` is the only writer and it never prunes, so
   * this is bounded here rather than trusted to be small. */
  private async registeredLanes(): Promise<LaneRef[]> {
    const lanes: LaneRef[] = [];
    let cursor = "0";
    do {
      const [next, batch] = await this.redis.sscan(
        LANE_REGISTRY_KEY,
        cursor,
        "COUNT",
        SSCAN_BATCH,
      );
      cursor = next;
      for (const member of batch) {
        const lane = parseLane(member);
        if (lane) lanes.push(lane);
      }
    } while (cursor !== "0" && lanes.length < SCAN_LANE_CAP);
    return lanes.slice(0, SCAN_LANE_CAP);
  }

  async scanLaneKinds({
    laneKinds,
    topN,
  }: {
    laneKinds: string[];
    topN?: number;
  }): Promise<LaneKindInfo[]> {
    const wanted = new Set(laneKinds);
    const refs = (await this.registeredLanes()).filter((lane) =>
      wanted.has(lane.laneKind),
    );
    const described = await this.describe(refs);

    return laneKinds.map((laneKind) => {
      const lanes = described.filter((lane) => lane.laneKind === laneKind);
      // Deepest first: an operator opening this page is looking for the backlog.
      const ranked = [...lanes].sort((a, b) => b.pendingJobs - a.pendingJobs);
      return {
        name: laneKind,
        displayName: laneKind,
        laneCount: lanes.length,
        parkedLaneCount: lanes.filter((lane) => lane.isParked).length,
        leasedLaneCount: lanes.filter((lane) => lane.leaseRemainingMs !== null)
          .length,
        totalPendingJobs: lanes.reduce(
          (sum, lane) => sum + lane.pendingJobs,
          0,
        ),
        lanes: topN === undefined ? ranked : ranked.slice(0, topN),
      };
    });
  }

  /** Six reads per lane, pipelined, so a page of hundreds is a few round trips. */
  private async describe(refs: LaneRef[]): Promise<LaneInfo[]> {
    if (refs.length === 0) return [];
    const now = Date.now();

    const pipeline = this.redis.pipeline();
    for (const ref of refs) {
      const keys = laneKeys(ref.laneId);
      pipeline.zcard(keys.z);
      pipeline.zrange(keys.z, 0, 0, "WITHSCORES");
      pipeline.hmget(keys.lease, "token", "expiresAt");
      pipeline.get(keys.ready);
      pipeline.get(keys.parked);
      pipeline.hvals(keys.h);
    }
    const results = (await pipeline.exec()) ?? [];

    return refs.map((ref, index) => {
      const at = (offset: number) => results[index * 6 + offset]?.[1];
      const parked = at(4);
      const expiresAt = secondElement(at(2));
      const readyAt = Number(at(3) ?? Number.NaN);

      return {
        ...ref,
        pendingJobs: Number(at(0) ?? 0),
        headOrderingKey: finiteOrNull(secondElement(at(1))),
        // Only a lease that has not expired holds the lane: an expired one is
        // simply claimable again, which is what makes worker death self-heal.
        leaseRemainingMs: laterThan(expiresAt, now) ? expiresAt - now : null,
        isParked: typeof parked === "string",
        parkReason: typeof parked === "string" ? parked : null,
        readyAtMs: laterThan(readyAt, now) ? readyAt : null,
        attempts: highestAttempt(at(5)),
      };
    });
  }

  async getLaneJobs({
    laneId,
    page,
    pageSize,
  }: {
    laneId: string;
    page: number;
    pageSize: number;
  }): Promise<{ jobs: JobEntry[]; total: number }> {
    const keys = laneKeys(laneId);
    const start = Math.max(page - 1, 0) * pageSize;
    const [total, members] = await Promise.all([
      this.redis.zcard(keys.z),
      this.redis.zrange(keys.z, start, start + pageSize - 1, "WITHSCORES"),
    ]);
    if (members.length === 0) return { jobs: [], total };

    const sequences = members.filter((_, index) => index % 2 === 0);
    const headers = await this.redis.hmget(keys.h, ...sequences);

    const jobs: JobEntry[] = [];
    for (let index = 0; index < sequences.length; index++) {
      const header = parseHeader(headers[index]);
      if (!header) continue;
      jobs.push({
        sequence: header.sequence,
        orderingKey: Number(members[index * 2 + 1] ?? 0),
        eventType: header.eventType,
        eventId: header.eventId,
        aggregateId: header.aggregateId,
        attempt: header.attempt,
        costBytes: header.costBytes,
        blobRef: header.blobRef ?? null,
      });
    }
    return { jobs, total };
  }

  /**
   * Parked lanes, clustered by why the consumer parked them.
   *
   * The park reason is the only failure text the plane keeps — it replaces the
   * per-group error key and stack the old plane stored, so a cluster names the
   * failure but cannot show where it was thrown.
   */
  async getParkedSummary({
    laneKinds,
  }: {
    laneKinds: string[];
  }): Promise<ParkedSummary> {
    const wanted = new Set(laneKinds);
    const refs = (await this.registeredLanes()).filter((lane) =>
      wanted.has(lane.laneKind),
    );
    if (refs.length === 0) return { totalParked: 0, clusters: [] };

    const pipeline = this.redis.pipeline();
    for (const ref of refs) pipeline.get(laneKeys(ref.laneId).parked);
    const results = (await pipeline.exec()) ?? [];

    const clusters = new Map<string, ErrorCluster>();
    let totalParked = 0;
    for (const [index, ref] of refs.entries()) {
      const reason = results[index]?.[1];
      if (typeof reason !== "string") continue;
      totalParked += 1;
      cluster(clusters, ref, reason);
    }

    return {
      totalParked,
      clusters: [...clusters.values()]
        .sort((a, b) => b.count - a.count)
        .slice(0, SUMMARY_TOP_N),
    };
  }

  async unparkLane({
    laneId,
  }: {
    laneId: string;
  }): Promise<{ wasParked: boolean }> {
    // Unparking is only a DEL: the jobs never left the lane, so the next claim
    // picks the lane up with its attempts intact.
    const removed = await this.redis.del(laneKeys(laneId).parked);
    return { wasParked: removed > 0 };
  }

  async unparkAll({
    laneKind,
  }: {
    laneKind: string;
  }): Promise<{ unparkedCount: number }> {
    const refs = (await this.registeredLanes()).filter(
      (lane) => lane.laneKind === laneKind,
    );
    if (refs.length === 0) return { unparkedCount: 0 };

    const pipeline = this.redis.pipeline();
    for (const ref of refs) pipeline.del(laneKeys(ref.laneId).parked);
    const results = (await pipeline.exec()) ?? [];

    return {
      unparkedCount: results.reduce(
        (sum, result) => sum + Number(result?.[1] ?? 0),
        0,
      ),
    };
  }

  async drainLane({
    laneId,
  }: {
    laneId: string;
  }): Promise<{ jobsRemoved: number }> {
    const keys = laneKeys(laneId);
    const dropped = await drainLaneScript.run(
      this.redis,
      8,
      keys.z,
      keys.h,
      keys.b,
      keys.seq,
      keys.lease,
      keys.ready,
      keys.parked,
      LANE_REGISTRY_KEY,
      laneId,
    );
    const jobsRemoved = Number(dropped ?? 0);
    logger.warn({ laneId, jobsRemoved }, "Operator drained a lane");
    return { jobsRemoved };
  }

  async drainTenant({
    tenantId,
    laneIdContains,
  }: {
    tenantId: string;
    laneIdContains?: string;
  }): Promise<{ lanesDrained: number; jobsDrained: number }> {
    const refs = (await this.registeredLanes()).filter(
      (lane) =>
        lane.tenantId === tenantId &&
        (laneIdContains === undefined || lane.laneId.includes(laneIdContains)),
    );

    let jobsDrained = 0;
    for (const ref of refs) {
      const { jobsRemoved } = await this.drainLane({ laneId: ref.laneId });
      jobsDrained += jobsRemoved;
    }
    return { lanesDrained: refs.length, jobsDrained };
  }
}

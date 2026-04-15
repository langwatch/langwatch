import type IORedis from "ioredis";
import type { Cluster } from "ioredis";
import type { GroupInfo, QueueInfo, ErrorCluster } from "../types";
import type {
  QueueRepository,
  BlockedSummary,
  DlqGroupInfo,
  DrainPreview,
  JobEntry,
} from "./queue.repository";
import { normalizeErrorMessage } from "../normalize-error-message";

// ── Lua Scripts ──────────────────────────────────────────────────────

const UNBLOCK_LUA = `
local blockedKey = KEYS[1]
local activeKey  = KEYS[2]
local jobsKey    = KEYS[3]
local readyKey   = KEYS[4]
local signalKey  = KEYS[5]
local errorKey   = KEYS[6]
local groupId    = ARGV[1]

local wasBlocked = redis.call("SREM", blockedKey, groupId)

if wasBlocked > 0 then
  redis.call("DEL", activeKey)
  redis.call("DEL", errorKey)

  local pendingCount = redis.call("ZCARD", jobsKey)
  if pendingCount > 0 then
    local score = 1
    redis.call("ZADD", readyKey, score, groupId)
  else
    redis.call("ZREM", readyKey, groupId)
  end

  redis.call("LPUSH", signalKey, "1")
  redis.call("LTRIM", signalKey, 0, 999)
end

return wasBlocked
`;

const DRAIN_GROUP_LUA = `
local jobsKey    = KEYS[1]
local dataKey    = KEYS[2]
local activeKey  = KEYS[3]
local readyKey   = KEYS[4]
local blockedKey = KEYS[5]
local signalKey  = KEYS[6]
local errorKey   = KEYS[7]
local groupId    = ARGV[1]

local count = redis.call("ZCARD", jobsKey)

redis.call("DEL", jobsKey)
redis.call("DEL", dataKey)
redis.call("DEL", activeKey)
redis.call("DEL", errorKey)
redis.call("ZREM", readyKey, groupId)
redis.call("SREM", blockedKey, groupId)
redis.call("LPUSH", signalKey, "1")
redis.call("LTRIM", signalKey, 0, 999)

return count
`;

const MOVE_TO_DLQ_LUA = `
local srcJobsKey   = KEYS[1]
local srcDataKey   = KEYS[2]
local activeKey    = KEYS[3]
local readyKey     = KEYS[4]
local blockedKey   = KEYS[5]
local signalKey    = KEYS[6]
local srcErrorKey  = KEYS[7]
local dstJobsKey   = KEYS[8]
local dstDataKey   = KEYS[9]
local dstErrorKey  = KEYS[10]
local dlqIndexKey  = KEYS[11]
local groupId      = ARGV[1]
local ttl          = tonumber(ARGV[2])

local jobs = redis.call("ZRANGE", srcJobsKey, 0, -1, "WITHSCORES")
local count = #jobs / 2
if count > 0 then
  for i = 1, #jobs, 2 do
    redis.call("ZADD", dstJobsKey, jobs[i+1], jobs[i])
  end
end

local data = redis.call("HGETALL", srcDataKey)
for i = 1, #data, 2 do
  redis.call("HSET", dstDataKey, data[i], data[i+1])
end

local errorData = redis.call("HGETALL", srcErrorKey)
for i = 1, #errorData, 2 do
  redis.call("HSET", dstErrorKey, errorData[i], errorData[i+1])
end

if ttl > 0 then
  redis.call("EXPIRE", dstJobsKey, ttl)
  redis.call("EXPIRE", dstDataKey, ttl)
  redis.call("EXPIRE", dstErrorKey, ttl)
end

redis.call("SADD", dlqIndexKey, groupId)

redis.call("DEL", srcJobsKey)
redis.call("DEL", srcDataKey)
redis.call("DEL", activeKey)
redis.call("DEL", srcErrorKey)
redis.call("ZREM", readyKey, groupId)
redis.call("SREM", blockedKey, groupId)
redis.call("LPUSH", signalKey, "1")
redis.call("LTRIM", signalKey, 0, 999)

return count
`;

const REPLAY_FROM_DLQ_LUA = `
local dlqJobsKey   = KEYS[1]
local dlqDataKey   = KEYS[2]
local dlqErrorKey  = KEYS[3]
local dstJobsKey   = KEYS[4]
local dstDataKey   = KEYS[5]
local readyKey     = KEYS[6]
local signalKey    = KEYS[7]
local dlqIndexKey  = KEYS[8]
local groupId      = ARGV[1]

local jobs = redis.call("ZRANGE", dlqJobsKey, 0, -1, "WITHSCORES")
local count = #jobs / 2
if count > 0 then
  for i = 1, #jobs, 2 do
    redis.call("ZADD", dstJobsKey, jobs[i+1], jobs[i])
  end
end

local data = redis.call("HGETALL", dlqDataKey)
for i = 1, #data, 2 do
  redis.call("HSET", dstDataKey, data[i], data[i+1])
end

redis.call("DEL", dlqJobsKey)
redis.call("DEL", dlqDataKey)
redis.call("DEL", dlqErrorKey)
redis.call("SREM", dlqIndexKey, groupId)

if count > 0 then
  redis.call("ZADD", readyKey, 1, groupId)
end

redis.call("LPUSH", signalKey, "1")
redis.call("LTRIM", signalKey, 0, 999)

return count
`;

// ── Constants ────────────────────────────────────────────────────────

const SUMMARY_TOP_N = 200;
const DLQ_TTL_SECONDS = 604800;
const SSCAN_BATCH = 500;

// ── Helpers ──────────────────────────────────────────────────────────

function stripHashTag(name: string): string {
  if (name.startsWith("{") && name.endsWith("}")) {
    return name.slice(1, -1);
  }
  return name;
}

function parseRetryCount(id: string | null): number | null {
  if (!id) return null;
  const match = id.match(/\/r\/(\d+)$/);
  if (!match) return null;
  const n = parseInt(match[1]!, 10);
  return n < 1000 ? n : null;
}

// ── Repository Implementation ────────────────────────────────────────

export class QueueRedisRepository implements QueueRepository {
  private readonly redis: IORedis | Cluster;

  constructor(redis: IORedis | Cluster) {
    this.redis = redis;
  }

  // ── Queue Discovery & Scanning ──────────────────────────────────

  async discoverQueueNames(): Promise<string[]> {
    const names = new Set<string>();
    let cursor = "0";
    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        "MATCH",
        "*:gq:ready",
        "COUNT",
        50000,
      );
      cursor = nextCursor;
      for (const key of keys) {
        const gqIdx = key.indexOf(":gq:ready");
        if (gqIdx > 0) {
          names.add(key.slice(0, gqIdx));
        }
      }
    } while (cursor !== "0");

    return Array.from(names);
  }

  async scanQueues(params: {
    queueNames: string[];
    topN?: number;
  }): Promise<QueueInfo[]> {
    const queues = await Promise.all(
      params.queueNames.map((queueName) =>
        this.scanSingleQueue(queueName, params.topN ?? SUMMARY_TOP_N),
      ),
    );
    queues.sort((a, b) => a.displayName.localeCompare(b.displayName));
    return queues;
  }

  private async scanSingleQueue(
    queueName: string,
    limit: number,
    offset = 0,
  ): Promise<QueueInfo> {
    const displayName = stripHashTag(queueName);
    const prefix = `${queueName}:gq:`;

    const readyKey = `${prefix}ready`;
    const blockedKey = `${prefix}blocked`;
    const dlqKey = `${prefix}dlq`;
    const totalPendingKey = `${prefix}stats:total-pending`;

    const [readyCount, blockedCount, dlqCount, topReadyMembers, totalPendingRaw] =
      await Promise.all([
        this.redis.zcard(readyKey),
        this.redis.scard(blockedKey),
        this.redis.scard(dlqKey),
        this.redis.zrevrange(readyKey, offset, offset + limit - 1, "WITHSCORES"),
        this.redis.get(totalPendingKey),
      ]);

    const groupIds: string[] = [];
    const readyScores = new Map<string, number>();
    for (let i = 0; i < topReadyMembers.length; i += 2) {
      const groupId = topReadyMembers[i]!;
      const score = parseFloat(topReadyMembers[i + 1]!);
      groupIds.push(groupId);
      readyScores.set(groupId, score);
    }

    const blockedMembers =
      blockedCount > 0
        ? await this.redis.srandmember(blockedKey, Math.min(limit, blockedCount))
        : [];
    const readyGroupIdSet = new Set(groupIds);
    const blockedGroupIds = (blockedMembers ?? []).filter(
      (id): id is string => id !== null && !readyGroupIdSet.has(id),
    );

    const allGroupIds = [...groupIds, ...blockedGroupIds];

    const CMDS_PER_GROUP = 6;
    const pipeline = this.redis.pipeline();
    for (const groupId of allGroupIds) {
      const jobsKey = `${prefix}group:${groupId}:jobs`;
      const activeKey = `${prefix}group:${groupId}:active`;
      pipeline.zcard(jobsKey);
      pipeline.get(activeKey);
      pipeline.zrange(jobsKey, 0, 0, "WITHSCORES");
      pipeline.zrange(jobsKey, -1, -1, "WITHSCORES");
      pipeline.sismember(blockedKey, groupId);
      pipeline.ttl(`${prefix}group:${groupId}:active`);
    }

    const pipelineResults = await pipeline.exec();

    const firstJobIds: Array<{ groupId: string; jobId: string | null }> = [];
    for (let i = 0; i < allGroupIds.length; i++) {
      const base = i * CMDS_PER_GROUP;
      const oldestArr = (pipelineResults?.[base + 2]?.[1] as string[]) ?? [];
      firstJobIds.push({
        groupId: allGroupIds[i]!,
        jobId: oldestArr[0] ?? null,
      });
    }

    const dataPipeline = this.redis.pipeline();
    let dataFetchCount = 0;
    for (const { groupId, jobId } of firstJobIds) {
      if (jobId) {
        dataPipeline.hget(`${prefix}group:${groupId}:data`, jobId);
        dataFetchCount++;
      }
    }
    const dataResults =
      dataFetchCount > 0 ? await dataPipeline.exec() : [];

    const errorPipeline = this.redis.pipeline();
    for (const groupId of allGroupIds) {
      errorPipeline.hgetall(`${prefix}group:${groupId}:error`);
    }
    const errorResults =
      allGroupIds.length > 0 ? await errorPipeline.exec() : [];

    const groupErrors = new Map<
      string,
      { message: string; stack: string; timestamp: string }
    >();
    for (let i = 0; i < allGroupIds.length; i++) {
      const errorHash = errorResults?.[i]?.[1] as Record<string, string> | null;
      if (errorHash && errorHash.message) {
        groupErrors.set(allGroupIds[i]!, {
          message: errorHash.message,
          stack: errorHash.stack ?? "",
          timestamp: errorHash.timestamp ?? "",
        });
      }
    }

    let dataIdx = 0;
    const groups: GroupInfo[] = [];
    let activeGroupCount = 0;

    for (let i = 0; i < allGroupIds.length; i++) {
      const groupId = allGroupIds[i]!;
      const base = i * CMDS_PER_GROUP;

      const pendingJobs = (pipelineResults?.[base]?.[1] as number) ?? 0;
      const activeJobId =
        (pipelineResults?.[base + 1]?.[1] as string) ?? null;
      const oldestArr =
        (pipelineResults?.[base + 2]?.[1] as string[]) ?? [];
      const newestArr =
        (pipelineResults?.[base + 3]?.[1] as string[]) ?? [];
      const isBlocked = (pipelineResults?.[base + 4]?.[1] as number) === 1;
      const activeKeyTtlSec =
        (pipelineResults?.[base + 5]?.[1] as number) ?? -2;

      const oldestJobMs =
        oldestArr.length >= 2 ? parseFloat(oldestArr[1]!) : null;
      const newestJobMs =
        newestArr.length >= 2 ? parseFloat(newestArr[1]!) : null;

      let pipelineName: string | null = null;
      let jobType: string | null = null;
      let jobName: string | null = null;

      if (firstJobIds[i]!.jobId) {
        const rawData = (dataResults?.[dataIdx]?.[1] as string) ?? null;
        dataIdx++;
        if (rawData) {
          try {
            const parsed = JSON.parse(rawData);
            pipelineName = parsed.__pipelineName ?? null;
            jobType = parsed.__jobType ?? null;
            jobName = parsed.__jobName ?? null;
          } catch {
            // ignore invalid JSON
          }
        }
      }

      const errorInfo = groupErrors.get(groupId);
      if (activeJobId !== null) activeGroupCount++;

      groups.push({
        groupId,
        pendingJobs,
        score: readyScores.get(groupId) ?? 0,
        hasActiveJob: activeJobId !== null,
        activeJobId,
        isBlocked,
        oldestJobMs,
        newestJobMs,
        isStaleBlock: isBlocked && pendingJobs === 0 && activeJobId === null,
        pipelineName,
        jobType,
        jobName,
        errorMessage: errorInfo?.message ?? null,
        errorStack: errorInfo?.stack ?? null,
        errorTimestamp: errorInfo?.timestamp
          ? parseFloat(errorInfo.timestamp)
          : null,
        retryCount: parseRetryCount(firstJobIds[i]!.jobId),
        activeKeyTtlSec: activeKeyTtlSec > 0 ? activeKeyTtlSec : null,
        processingDurationMs: null,
      });
    }

    groups.sort((a, b) => b.pendingJobs - a.pendingJobs);

    let totalPendingJobs: number;
    if (totalPendingRaw !== null) {
      totalPendingJobs = Math.max(0, parseInt(totalPendingRaw, 10) || 0);
    } else {
      totalPendingJobs = 0;
      for (const g of groups) {
        totalPendingJobs += g.pendingJobs;
      }
    }

    return {
      name: queueName,
      displayName,
      pendingGroupCount: readyCount,
      blockedGroupCount: blockedCount,
      activeGroupCount,
      totalPendingJobs,
      dlqCount,
      groups,
    };
  }

  // ── Job Browsing ────────────────────────────────────────────────

  async getGroupJobs(params: {
    queueName: string;
    groupId: string;
    page: number;
    pageSize: number;
  }): Promise<{ jobs: JobEntry[]; total: number }> {
    const prefix = `${params.queueName}:gq:`;
    const jobsKey = `${prefix}group:${params.groupId}:jobs`;

    const total = await this.redis.zcard(jobsKey);
    const start = (params.page - 1) * params.pageSize;
    const end = start + params.pageSize - 1;
    const jobEntries = await this.redis.zrange(
      jobsKey,
      start,
      end,
      "WITHSCORES",
    );

    const jobs: JobEntry[] = [];
    const jobIds: string[] = [];

    for (let i = 0; i < jobEntries.length; i += 2) {
      const jobId = jobEntries[i]!;
      const score = parseFloat(jobEntries[i + 1]!);
      jobIds.push(jobId);
      jobs.push({ jobId, score, data: null });
    }

    if (jobIds.length > 0) {
      const dataPipeline = this.redis.pipeline();
      for (const jobId of jobIds) {
        dataPipeline.hget(
          `${prefix}group:${params.groupId}:data`,
          jobId,
        );
      }
      const dataResults = await dataPipeline.exec();

      for (let i = 0; i < jobIds.length; i++) {
        const raw = dataResults?.[i]?.[1] as string | null;
        if (raw) {
          try {
            jobs[i]!.data = JSON.parse(raw);
          } catch {
            // ignore invalid JSON
          }
        }
      }
    }

    return { jobs, total };
  }

  // ── Blocked Group Analysis ─────────────────────────────────────

  async getBlockedSummary(params: {
    queueNames: string[];
  }): Promise<BlockedSummary> {
    let totalBlocked = 0;
    const clusterMap = new Map<string, ErrorCluster>();

    for (const queueName of params.queueNames) {
      const prefix = `${queueName}:gq:`;
      const blockedKey = `${prefix}blocked`;

      let cursor = "0";
      do {
        const [nextCursor, members] = await this.redis.sscan(
          blockedKey,
          cursor,
          "COUNT",
          SSCAN_BATCH,
        );
        cursor = nextCursor;
        totalBlocked += members.length;

        if (members.length === 0) continue;

        const pipeline = this.redis.pipeline();
        for (const groupId of members) {
          pipeline.hgetall(`${prefix}group:${groupId}:error`);
          pipeline.zrange(`${prefix}group:${groupId}:jobs`, 0, 0);
        }
        const results = await pipeline.exec();

        const jobDataPipeline = this.redis.pipeline();
        const jobDataRequests: { groupId: string; jobId: string }[] = [];
        for (let i = 0; i < members.length; i++) {
          const jobArr = (results?.[i * 2 + 1]?.[1] as string[]) ?? [];
          if (jobArr[0]) {
            jobDataPipeline.hget(
              `${prefix}group:${members[i]!}:data`,
              jobArr[0],
            );
            jobDataRequests.push({ groupId: members[i]!, jobId: jobArr[0] });
          }
        }
        const jobDataResults =
          jobDataRequests.length > 0 ? await jobDataPipeline.exec() : [];

        const pipelineNames = new Map<string, string>();
        for (let i = 0; i < jobDataRequests.length; i++) {
          const raw = jobDataResults?.[i]?.[1] as string | null;
          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              if (parsed.__pipelineName) {
                pipelineNames.set(
                  jobDataRequests[i]!.groupId,
                  parsed.__pipelineName,
                );
              }
            } catch {
              // ignore parse errors
            }
          }
        }

        for (let i = 0; i < members.length; i++) {
          const groupId = members[i]!;
          const errorHash = results?.[i * 2]?.[1] as Record<
            string,
            string
          > | null;
          const message = errorHash?.message ?? "Unknown error";
          const stack = errorHash?.stack ?? null;
          const pipelineName = pipelineNames.get(groupId) ?? null;

          const normalized = normalizeErrorMessage(message);
          const clusterKey = `${pipelineName ?? ""}::${normalized}`;

          const existing = clusterMap.get(clusterKey);
          if (existing) {
            existing.count++;
            if (existing.sampleGroupIds.length < 5) {
              existing.sampleGroupIds.push(groupId);
            }
          } else {
            clusterMap.set(clusterKey, {
              normalizedMessage: normalized,
              sampleMessage: message,
              sampleStack: stack,
              count: 1,
              pipelineName,
              queueName,
              sampleGroupIds: [groupId],
            });
          }
        }
      } while (cursor !== "0");
    }

    const clusters = Array.from(clusterMap.values()).sort(
      (a, b) => b.count - a.count,
    );

    return { totalBlocked, clusters };
  }

  // ── Actions ─────────────────────────────────────────────────────

  async unblockGroup(params: {
    queueName: string;
    groupId: string;
  }): Promise<{ wasBlocked: boolean }> {
    const prefix = `${params.queueName}:gq:`;
    const result = await this.redis.eval(
      UNBLOCK_LUA,
      6,
      `${prefix}blocked`,
      `${prefix}group:${params.groupId}:active`,
      `${prefix}group:${params.groupId}:jobs`,
      `${prefix}ready`,
      `${prefix}signal`,
      `${prefix}group:${params.groupId}:error`,
      params.groupId,
    );
    return { wasBlocked: result === 1 };
  }

  async unblockAll(params: {
    queueName: string;
  }): Promise<{ unblockedCount: number }> {
    const prefix = `${params.queueName}:gq:`;
    const blockedKey = `${prefix}blocked`;
    let unblockedCount = 0;

    let cursor = "0";
    do {
      const [nextCursor, members] = await this.redis.sscan(
        blockedKey,
        cursor,
        "COUNT",
        SSCAN_BATCH,
      );
      cursor = nextCursor;

      if (members.length === 0) continue;

      const pipeline = this.redis.pipeline();
      for (const groupId of members) {
        pipeline.eval(
          UNBLOCK_LUA,
          6,
          `${prefix}blocked`,
          `${prefix}group:${groupId}:active`,
          `${prefix}group:${groupId}:jobs`,
          `${prefix}ready`,
          `${prefix}signal`,
          `${prefix}group:${groupId}:error`,
          groupId,
        );
      }
      const results = await pipeline.exec();
      if (results) {
        for (const [err, result] of results) {
          if (!err && result === 1) unblockedCount++;
        }
      }
    } while (cursor !== "0");

    return { unblockedCount };
  }

  async drainGroup(params: {
    queueName: string;
    groupId: string;
  }): Promise<{ jobsRemoved: number }> {
    const prefix = `${params.queueName}:gq:`;
    const result = await this.redis.eval(
      DRAIN_GROUP_LUA,
      7,
      `${prefix}group:${params.groupId}:jobs`,
      `${prefix}group:${params.groupId}:data`,
      `${prefix}group:${params.groupId}:active`,
      `${prefix}ready`,
      `${prefix}blocked`,
      `${prefix}signal`,
      `${prefix}group:${params.groupId}:error`,
      params.groupId,
    );
    return { jobsRemoved: Number(result) };
  }

  async pausePipeline(params: {
    queueName: string;
    key: string;
  }): Promise<void> {
    await this.redis.sadd(`${params.queueName}:gq:paused-jobs`, params.key);
  }

  async unpausePipeline(params: {
    queueName: string;
    key: string;
  }): Promise<void> {
    await this.redis.srem(`${params.queueName}:gq:paused-jobs`, params.key);
    await this.redis.lpush(`${params.queueName}:gq:signal`, "1");
  }

  async retryBlocked(params: {
    queueName: string;
    groupId: string;
    jobId: string;
  }): Promise<{ wasBlocked: boolean }> {
    return this.unblockGroup({
      queueName: params.queueName,
      groupId: params.groupId,
    });
  }

  async listPausedKeys(params: {
    queueName: string;
  }): Promise<string[]> {
    return this.redis.smembers(`${params.queueName}:gq:paused-jobs`);
  }

  // ── DLQ Operations ──────────────────────────────────────────────

  async moveToDlq(params: {
    queueName: string;
    groupId: string;
  }): Promise<{ jobsMoved: number }> {
    const prefix = `${params.queueName}:gq:`;
    const result = await this.redis.eval(
      MOVE_TO_DLQ_LUA,
      11,
      `${prefix}group:${params.groupId}:jobs`,
      `${prefix}group:${params.groupId}:data`,
      `${prefix}group:${params.groupId}:active`,
      `${prefix}ready`,
      `${prefix}blocked`,
      `${prefix}signal`,
      `${prefix}group:${params.groupId}:error`,
      `${prefix}dlq:${params.groupId}:jobs`,
      `${prefix}dlq:${params.groupId}:data`,
      `${prefix}dlq:${params.groupId}:error`,
      `${prefix}dlq`,
      params.groupId,
      String(DLQ_TTL_SECONDS),
    );
    return { jobsMoved: Number(result) };
  }

  async moveAllBlockedToDlq(params: {
    queueName: string;
    pipelineFilter?: string;
    errorFilter?: string;
  }): Promise<{ movedCount: number; jobsMoved: number }> {
    const prefix = `${params.queueName}:gq:`;
    const blockedKey = `${prefix}blocked`;
    let movedCount = 0;
    let jobsMoved = 0;
    const hasFilters = !!params.pipelineFilter || !!params.errorFilter;

    let cursor = "0";
    do {
      const [nextCursor, members] = await this.redis.sscan(
        blockedKey,
        cursor,
        "COUNT",
        SSCAN_BATCH,
      );
      cursor = nextCursor;

      if (members.length === 0) continue;

      const groupsToMove = hasFilters
        ? await this.filterBlockedGroups({
            prefix,
            members,
            pipelineFilter: params.pipelineFilter,
            errorFilter: params.errorFilter,
          })
        : members;

      if (groupsToMove.length === 0) continue;

      const pipeline = this.redis.pipeline();
      for (const groupId of groupsToMove) {
        pipeline.eval(
          MOVE_TO_DLQ_LUA,
          11,
          `${prefix}group:${groupId}:jobs`,
          `${prefix}group:${groupId}:data`,
          `${prefix}group:${groupId}:active`,
          `${prefix}ready`,
          `${prefix}blocked`,
          `${prefix}signal`,
          `${prefix}group:${groupId}:error`,
          `${prefix}dlq:${groupId}:jobs`,
          `${prefix}dlq:${groupId}:data`,
          `${prefix}dlq:${groupId}:error`,
          `${prefix}dlq`,
          groupId,
          String(DLQ_TTL_SECONDS),
        );
      }
      const results = await pipeline.exec();
      if (results) {
        for (const [err, result] of results) {
          if (!err) {
            const moved = Number(result);
            if (moved >= 0) {
              movedCount++;
              jobsMoved += moved;
            }
          }
        }
      }
    } while (cursor !== "0");

    return { movedCount, jobsMoved };
  }

  async replayFromDlq(params: {
    queueName: string;
    groupId: string;
  }): Promise<{ jobsReplayed: number }> {
    const prefix = `${params.queueName}:gq:`;
    const result = await this.redis.eval(
      REPLAY_FROM_DLQ_LUA,
      8,
      `${prefix}dlq:${params.groupId}:jobs`,
      `${prefix}dlq:${params.groupId}:data`,
      `${prefix}dlq:${params.groupId}:error`,
      `${prefix}group:${params.groupId}:jobs`,
      `${prefix}group:${params.groupId}:data`,
      `${prefix}ready`,
      `${prefix}signal`,
      `${prefix}dlq`,
      params.groupId,
    );
    return { jobsReplayed: Number(result) };
  }

  async replayAllFromDlq(params: {
    queueName: string;
    pipelineFilter?: string;
    errorFilter?: string;
  }): Promise<{ replayedCount: number; jobsReplayed: number }> {
    const prefix = `${params.queueName}:gq:`;
    const dlqIndexKey = `${prefix}dlq`;
    let replayedCount = 0;
    let jobsReplayed = 0;
    const hasFilters = !!params.pipelineFilter || !!params.errorFilter;

    let cursor = "0";
    do {
      const [nextCursor, members] = await this.redis.sscan(
        dlqIndexKey,
        cursor,
        "COUNT",
        SSCAN_BATCH,
      );
      cursor = nextCursor;

      if (members.length === 0) continue;

      const groupsToReplay = hasFilters
        ? await this.filterDlqGroups({
            prefix,
            members,
            pipelineFilter: params.pipelineFilter,
            errorFilter: params.errorFilter,
          })
        : members;

      if (groupsToReplay.length === 0) continue;

      const pipeline = this.redis.pipeline();
      for (const groupId of groupsToReplay) {
        pipeline.eval(
          REPLAY_FROM_DLQ_LUA,
          8,
          `${prefix}dlq:${groupId}:jobs`,
          `${prefix}dlq:${groupId}:data`,
          `${prefix}dlq:${groupId}:error`,
          `${prefix}group:${groupId}:jobs`,
          `${prefix}group:${groupId}:data`,
          `${prefix}ready`,
          `${prefix}signal`,
          `${prefix}dlq`,
          groupId,
        );
      }
      const results = await pipeline.exec();
      if (results) {
        for (const [err, result] of results) {
          if (!err) {
            const replayed = Number(result);
            if (replayed > 0) {
              replayedCount++;
              jobsReplayed += replayed;
            }
          }
        }
      }
    } while (cursor !== "0");

    return { replayedCount, jobsReplayed };
  }

  // ── Canary Operations ───────────────────────────────────────────

  async canaryRedrive(params: {
    queueName: string;
    count?: number;
    pipelineFilter?: string;
  }): Promise<{ redrivenCount: number; groupIds: string[] }> {
    const count = params.count ?? 5;
    const prefix = `${params.queueName}:gq:`;
    const dlqIndexKey = `${prefix}dlq`;

    const dlqSize = await this.redis.scard(dlqIndexKey);
    if (dlqSize === 0) return { redrivenCount: 0, groupIds: [] };

    const candidates = await this.redis.srandmember(
      dlqIndexKey,
      Math.min(count * 3, dlqSize),
    );
    if (!candidates || candidates.length === 0)
      return { redrivenCount: 0, groupIds: [] };

    let groupsToRedrive = candidates.filter(
      (id): id is string => id !== null,
    );

    if (params.pipelineFilter) {
      groupsToRedrive = await this.filterByPipelineName({
        prefix,
        members: groupsToRedrive,
        pipelineFilter: params.pipelineFilter,
        keyPrefix: "dlq",
      });
    }

    groupsToRedrive = groupsToRedrive.slice(0, count);
    if (groupsToRedrive.length === 0)
      return { redrivenCount: 0, groupIds: [] };

    const pipeline = this.redis.pipeline();
    for (const groupId of groupsToRedrive) {
      pipeline.eval(
        REPLAY_FROM_DLQ_LUA,
        8,
        `${prefix}dlq:${groupId}:jobs`,
        `${prefix}dlq:${groupId}:data`,
        `${prefix}dlq:${groupId}:error`,
        `${prefix}group:${groupId}:jobs`,
        `${prefix}group:${groupId}:data`,
        `${prefix}ready`,
        `${prefix}signal`,
        `${prefix}dlq`,
        groupId,
      );
    }
    const results = await pipeline.exec();

    let redrivenCount = 0;
    const redrivenIds: string[] = [];
    if (results) {
      for (let i = 0; i < results.length; i++) {
        const [err, result] = results[i]!;
        if (!err && Number(result) > 0) {
          redrivenCount++;
          redrivenIds.push(groupsToRedrive[i]!);
        }
      }
    }

    return { redrivenCount, groupIds: redrivenIds };
  }

  async canaryUnblock(params: {
    queueName: string;
    count?: number;
    pipelineFilter?: string;
  }): Promise<{ unblockedCount: number; groupIds: string[] }> {
    const count = params.count ?? 5;
    const prefix = `${params.queueName}:gq:`;
    const blockedKey = `${prefix}blocked`;

    const candidates = await this.redis.srandmember(blockedKey, count * 3);
    if (!candidates || candidates.length === 0)
      return { unblockedCount: 0, groupIds: [] };

    let groupsToUnblock = candidates.filter(
      (id): id is string => id !== null,
    );

    if (params.pipelineFilter) {
      groupsToUnblock = await this.filterByPipelineName({
        prefix,
        members: groupsToUnblock,
        pipelineFilter: params.pipelineFilter,
        keyPrefix: "group",
      });
    }

    groupsToUnblock = groupsToUnblock.slice(0, count);
    if (groupsToUnblock.length === 0)
      return { unblockedCount: 0, groupIds: [] };

    const unblockPipeline = this.redis.pipeline();
    for (const groupId of groupsToUnblock) {
      unblockPipeline.eval(
        UNBLOCK_LUA,
        6,
        `${prefix}blocked`,
        `${prefix}group:${groupId}:active`,
        `${prefix}group:${groupId}:jobs`,
        `${prefix}ready`,
        `${prefix}signal`,
        `${prefix}group:${groupId}:error`,
        groupId,
      );
    }
    const results = await unblockPipeline.exec();

    let unblockedCount = 0;
    const unblockedIds: string[] = [];
    if (results) {
      for (let i = 0; i < results.length; i++) {
        const [err, result] = results[i]!;
        if (!err && result === 1) {
          unblockedCount++;
          unblockedIds.push(groupsToUnblock[i]!);
        }
      }
    }

    return { unblockedCount, groupIds: unblockedIds };
  }

  // ── DLQ Listing ─────────────────────────────────────────────────

  async listDlqGroups(params: {
    queueName: string;
  }): Promise<DlqGroupInfo[]> {
    const prefix = `${params.queueName}:gq:`;
    const dlqIndexKey = `${prefix}dlq`;
    const groups: DlqGroupInfo[] = [];

    let cursor = "0";
    do {
      const [nextCursor, members] = await this.redis.sscan(
        dlqIndexKey,
        cursor,
        "COUNT",
        SSCAN_BATCH,
      );
      cursor = nextCursor;

      if (members.length === 0) continue;

      const pipeline = this.redis.pipeline();
      for (const groupId of members) {
        pipeline.hgetall(`${prefix}dlq:${groupId}:error`);
        pipeline.zcard(`${prefix}dlq:${groupId}:jobs`);
        pipeline.zrange(`${prefix}dlq:${groupId}:jobs`, 0, 0);
      }
      const results = await pipeline.exec();

      const dataPipeline = this.redis.pipeline();
      const dataRequests: { groupId: string; idx: number }[] = [];
      for (let i = 0; i < members.length; i++) {
        const jobArr = (results?.[i * 3 + 2]?.[1] as string[]) ?? [];
        if (jobArr[0]) {
          dataPipeline.hget(`${prefix}dlq:${members[i]!}:data`, jobArr[0]);
          dataRequests.push({ groupId: members[i]!, idx: i });
        }
      }
      const dataResults =
        dataRequests.length > 0 ? await dataPipeline.exec() : [];

      const groupPipelines = new Map<string, string>();
      for (let j = 0; j < dataRequests.length; j++) {
        const raw = dataResults?.[j]?.[1] as string | null;
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            if (parsed.__pipelineName) {
              groupPipelines.set(
                dataRequests[j]!.groupId,
                parsed.__pipelineName,
              );
            }
          } catch {
            // ignore
          }
        }
      }

      for (let i = 0; i < members.length; i++) {
        const groupId = members[i]!;
        const errorHash = results?.[i * 3]?.[1] as Record<
          string,
          string
        > | null;
        const jobCount = (results?.[i * 3 + 1]?.[1] as number) ?? 0;

        groups.push({
          groupId,
          error: errorHash?.message ?? null,
          errorStack: errorHash?.stack ?? null,
          pipelineName: groupPipelines.get(groupId) ?? null,
          jobCount,
          movedAt: errorHash?.timestamp
            ? parseFloat(errorHash.timestamp)
            : null,
        });
      }
    } while (cursor !== "0");

    groups.sort((a, b) => (b.movedAt ?? 0) - (a.movedAt ?? 0));
    return groups;
  }

  // ── Preview ─────────────────────────────────────────────────────

  async drainAllBlockedPreview(params: {
    queueName: string;
    pipelineFilter?: string;
    errorFilter?: string;
  }): Promise<DrainPreview> {
    const prefix = `${params.queueName}:gq:`;
    const blockedKey = `${prefix}blocked`;
    let totalAffected = 0;
    const pipelineCounts = new Map<string, number>();
    const errorCounts = new Map<string, number>();

    let cursor = "0";
    do {
      const [nextCursor, members] = await this.redis.sscan(
        blockedKey,
        cursor,
        "COUNT",
        SSCAN_BATCH,
      );
      cursor = nextCursor;

      if (members.length === 0) continue;

      const pipeline = this.redis.pipeline();
      for (const groupId of members) {
        pipeline.hgetall(`${prefix}group:${groupId}:error`);
        pipeline.zrange(`${prefix}group:${groupId}:jobs`, 0, 0);
      }
      const results = await pipeline.exec();

      const jobDataPipeline = this.redis.pipeline();
      const jobDataRequests: { groupId: string }[] = [];
      for (let i = 0; i < members.length; i++) {
        const jobArr = (results?.[i * 2 + 1]?.[1] as string[]) ?? [];
        if (jobArr[0]) {
          jobDataPipeline.hget(
            `${prefix}group:${members[i]!}:data`,
            jobArr[0],
          );
          jobDataRequests.push({ groupId: members[i]! });
        }
      }
      const jobDataResults =
        jobDataRequests.length > 0 ? await jobDataPipeline.exec() : [];

      const groupPipelines = new Map<string, string>();
      for (let j = 0; j < jobDataRequests.length; j++) {
        const raw = jobDataResults?.[j]?.[1] as string | null;
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            if (parsed.__pipelineName) {
              groupPipelines.set(
                jobDataRequests[j]!.groupId,
                parsed.__pipelineName,
              );
            }
          } catch {
            // ignore
          }
        }
      }

      for (let i = 0; i < members.length; i++) {
        const groupId = members[i]!;
        const errorHash = results?.[i * 2]?.[1] as Record<
          string,
          string
        > | null;
        const msg = errorHash?.message ?? "Unknown error";
        const pName = groupPipelines.get(groupId) ?? "unknown";

        if (
          params.errorFilter &&
          !msg.toLowerCase().includes(params.errorFilter.toLowerCase())
        )
          continue;
        if (params.pipelineFilter && pName !== params.pipelineFilter) continue;

        totalAffected++;
        pipelineCounts.set(pName, (pipelineCounts.get(pName) ?? 0) + 1);

        const normalizedMsg = normalizeErrorMessage(msg);
        errorCounts.set(
          normalizedMsg,
          (errorCounts.get(normalizedMsg) ?? 0) + 1,
        );
      }
    } while (cursor !== "0");

    return {
      totalAffected,
      byPipeline: Array.from(pipelineCounts.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
      byError: Array.from(errorCounts.entries())
        .map(([message, count]) => ({ message, count }))
        .sort((a, b) => b.count - a.count),
    };
  }

  // ── Private Filter Helpers ──────────────────────────────────────

  private async filterByPipelineName(params: {
    prefix: string;
    members: string[];
    pipelineFilter: string;
    keyPrefix: "group" | "dlq";
  }): Promise<string[]> {
    const jobIdPipeline = this.redis.pipeline();
    for (const groupId of params.members) {
      jobIdPipeline.zrange(
        `${params.prefix}${params.keyPrefix}:${groupId}:jobs`,
        0,
        0,
      );
    }
    const jobIdResults = await jobIdPipeline.exec();

    const dataPipeline = this.redis.pipeline();
    const dataRequests: { groupId: string }[] = [];
    for (let i = 0; i < params.members.length; i++) {
      const jobArr = (jobIdResults?.[i]?.[1] as string[]) ?? [];
      if (jobArr[0]) {
        dataPipeline.hget(
          `${params.prefix}${params.keyPrefix}:${params.members[i]!}:data`,
          jobArr[0],
        );
        dataRequests.push({ groupId: params.members[i]! });
      }
    }
    const dataResults =
      dataRequests.length > 0 ? await dataPipeline.exec() : [];

    const matchingGroups = new Set<string>();
    for (let i = 0; i < dataRequests.length; i++) {
      const raw = dataResults?.[i]?.[1] as string | null;
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.__pipelineName === params.pipelineFilter) {
            matchingGroups.add(dataRequests[i]!.groupId);
          }
        } catch {
          // ignore
        }
      }
    }
    return params.members.filter((id) => matchingGroups.has(id));
  }

  private async filterBlockedGroups(params: {
    prefix: string;
    members: string[];
    pipelineFilter?: string;
    errorFilter?: string;
  }): Promise<string[]> {
    const filterPipeline = this.redis.pipeline();
    for (const groupId of params.members) {
      filterPipeline.hgetall(`${params.prefix}group:${groupId}:error`);
      filterPipeline.zrange(`${params.prefix}group:${groupId}:jobs`, 0, 0);
    }
    const filterResults = await filterPipeline.exec();

    const jobDataPipeline = this.redis.pipeline();
    const jobDataMap = new Map<string, number>();
    let jobFetchIdx = 0;
    for (let i = 0; i < params.members.length; i++) {
      const jobArr = (filterResults?.[i * 2 + 1]?.[1] as string[]) ?? [];
      if (jobArr[0]) {
        jobDataPipeline.hget(
          `${params.prefix}group:${params.members[i]!}:data`,
          jobArr[0],
        );
        jobDataMap.set(params.members[i]!, jobFetchIdx++);
      }
    }
    const jobDataResults =
      jobFetchIdx > 0 ? await jobDataPipeline.exec() : [];

    return params.members.filter((groupId, i) => {
      if (params.errorFilter) {
        const errorHash = filterResults?.[i * 2]?.[1] as Record<
          string,
          string
        > | null;
        const msg = errorHash?.message ?? "";
        if (!msg.toLowerCase().includes(params.errorFilter.toLowerCase()))
          return false;
      }
      if (params.pipelineFilter) {
        const fetchIdx = jobDataMap.get(groupId);
        if (fetchIdx !== undefined) {
          const raw = jobDataResults?.[fetchIdx]?.[1] as string | null;
          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              if (parsed.__pipelineName !== params.pipelineFilter) return false;
            } catch {
              return false;
            }
          } else return false;
        } else return false;
      }
      return true;
    });
  }

  private async filterDlqGroups(params: {
    prefix: string;
    members: string[];
    pipelineFilter?: string;
    errorFilter?: string;
  }): Promise<string[]> {
    const filterPipeline = this.redis.pipeline();
    for (const groupId of params.members) {
      filterPipeline.hgetall(`${params.prefix}dlq:${groupId}:error`);
      filterPipeline.zrange(`${params.prefix}dlq:${groupId}:jobs`, 0, 0);
    }
    const filterResults = await filterPipeline.exec();

    const jobDataPipeline = this.redis.pipeline();
    const jobDataMap = new Map<string, number>();
    let jobFetchIdx = 0;
    for (let i = 0; i < params.members.length; i++) {
      const jobArr = (filterResults?.[i * 2 + 1]?.[1] as string[]) ?? [];
      if (jobArr[0]) {
        jobDataPipeline.hget(
          `${params.prefix}dlq:${params.members[i]!}:data`,
          jobArr[0],
        );
        jobDataMap.set(params.members[i]!, jobFetchIdx++);
      }
    }
    const jobDataResults =
      jobFetchIdx > 0 ? await jobDataPipeline.exec() : [];

    return params.members.filter((groupId, i) => {
      if (params.errorFilter) {
        const errorHash = filterResults?.[i * 2]?.[1] as Record<
          string,
          string
        > | null;
        const msg = errorHash?.message ?? "";
        if (!msg.toLowerCase().includes(params.errorFilter.toLowerCase()))
          return false;
      }
      if (params.pipelineFilter) {
        const fetchIdx = jobDataMap.get(groupId);
        if (fetchIdx !== undefined) {
          const raw = jobDataResults?.[fetchIdx]?.[1] as string | null;
          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              if (parsed.__pipelineName !== params.pipelineFilter) return false;
            } catch {
              return false;
            }
          } else return false;
        } else return false;
      }
      return true;
    });
  }
}

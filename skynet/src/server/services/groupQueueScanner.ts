import type IORedis from "ioredis";
import type { GroupInfo, QueueInfo } from "../../shared/types.ts";
import { stripHashTag } from "./queueDiscovery.ts";

function parseRetryCount(id: string | null): number | null {
  if (!id) return null;
  const match = id.match(/\/r\/(\d+)$/);
  if (!match) return null;
  const n = parseInt(match[1]!, 10);
  return n < 1000 ? n : null;
}

/** Max groups to fetch per queue during the periodic 2s collection cycle.
 *  Covers the dashboard table (default 25 shown) and pipeline tree metadata. */
const SUMMARY_TOP_N = 200;

/**
 * Lightweight scan for the periodic collection cycle.
 * Uses ZCARD/SCARD for counts + fetches only top N groups for details.
 */
export async function scanGroupQueues(
  redis: IORedis,
  groupQueueNames: string[],
): Promise<QueueInfo[]> {
  const queues = await Promise.all(
    groupQueueNames.map((queueName) => scanSingleQueue(redis, queueName, SUMMARY_TOP_N)),
  );

  queues.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return queues;
}

/**
 * Paginated scan for the /api/groups endpoint.
 * Fetches groups on-demand with offset/limit.
 */
export async function scanGroupQueuesPaginated(
  redis: IORedis,
  groupQueueNames: string[],
  { page = 0, pageSize = 100 }: { page?: number; pageSize?: number } = {},
): Promise<QueueInfo[]> {
  const offset = page * pageSize;
  const queues = await Promise.all(
    groupQueueNames.map((queueName) => scanSingleQueue(redis, queueName, pageSize, offset)),
  );

  queues.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return queues;
}

async function scanSingleQueue(
  redis: IORedis,
  queueName: string,
  limit: number,
  offset = 0,
): Promise<QueueInfo> {
  const displayName = stripHashTag(queueName);
  const prefix = `${queueName}:gq:`;

  const readyKey = `${prefix}ready`;
  const blockedKey = `${prefix}blocked`;

  // O(1) counts + top N members by score
  const [readyCount, blockedCount, topReadyMembers] = await Promise.all([
    redis.zcard(readyKey),
    redis.scard(blockedKey),
    redis.zrevrange(readyKey, offset, offset + limit - 1, "WITHSCORES"),
  ]);

  // Build sampled group IDs from ready set page
  const groupIds: string[] = [];
  const readyScores = new Map<string, number>();
  for (let i = 0; i < topReadyMembers.length; i += 2) {
    const groupId = topReadyMembers[i]!;
    const score = parseFloat(topReadyMembers[i + 1]!);
    groupIds.push(groupId);
    readyScores.set(groupId, score);
  }

  // Also fetch blocked groups (they are NOT in the ready set)
  const blockedMembers = blockedCount > 0
    ? await redis.srandmember(blockedKey, Math.min(limit, blockedCount))
    : [];
  // Deduplicate: some groups might be in both ready and blocked during transitions
  const readyGroupIdSet = new Set(groupIds);
  const blockedGroupIds = (blockedMembers ?? []).filter(
    (id): id is string => id !== null && !readyGroupIdSet.has(id),
  );

  // Combine: all ready groups + sampled blocked groups (deduped)
  const allGroupIds = [...groupIds, ...blockedGroupIds];

  // Pipeline: core group data + blocked check per sampled group
  const CMDS_PER_GROUP = 6; // zcard, get, zrange oldest, zrange newest, sismember blocked, ttl active
  const pipeline = redis.pipeline();
  for (const groupId of allGroupIds) {
    const jobsKey = `${prefix}group:${groupId}:jobs`;
    const activeKey = `${prefix}group:${groupId}:active`;
    pipeline.zcard(jobsKey);
    pipeline.get(activeKey);
    pipeline.zrange(jobsKey, 0, 0, "WITHSCORES");   // oldest + its ID
    pipeline.zrange(jobsKey, -1, -1, "WITHSCORES");  // newest
    pipeline.sismember(blockedKey, groupId);
    pipeline.ttl(`${prefix}group:${groupId}:active`);
  }

  const pipelineResults = await pipeline.exec();

  // Collect first job IDs from the oldest ZRANGE result
  const firstJobIds: Array<{ groupId: string; jobId: string | null }> = [];
  for (let i = 0; i < allGroupIds.length; i++) {
    const base = i * CMDS_PER_GROUP;
    const oldestArr = (pipelineResults?.[base + 2]?.[1] as string[]) ?? [];
    firstJobIds.push({
      groupId: allGroupIds[i]!,
      jobId: oldestArr[0] ?? null,
    });
  }

  // Pipeline 2: Fetch metadata from first job's data hash + error info for blocked groups
  const blockedGroupIndices: number[] = [];
  const dataPipeline = redis.pipeline();
  let dataFetchCount = 0;
  for (let i = 0; i < firstJobIds.length; i++) {
    const { groupId, jobId } = firstJobIds[i]!;
    if (jobId) {
      const dataKey = `${prefix}group:${groupId}:data`;
      dataPipeline.hget(dataKey, jobId);
      dataFetchCount++;
    }
    // Check if this group is blocked (from pipeline 1 results)
    const base = i * CMDS_PER_GROUP;
    const isBlocked = (pipelineResults?.[base + 4]?.[1] as number) === 1;
    if (isBlocked) {
      dataPipeline.hgetall(`${prefix}group:${groupId}:error`);
      blockedGroupIndices.push(i);
    }
  }
  const dataResults = dataFetchCount > 0 || blockedGroupIndices.length > 0
    ? await dataPipeline.exec()
    : [];

  // Parse results: first dataFetchCount entries are job data, rest are error hashes
  const groupErrors = new Map<string, { message: string; stack: string; timestamp: string }>();
  for (let i = 0; i < blockedGroupIndices.length; i++) {
    const errorHash = dataResults?.[dataFetchCount + i]?.[1] as Record<string, string> | null;
    if (errorHash && errorHash.message) {
      groupErrors.set(allGroupIds[blockedGroupIndices[i]!]!, {
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
    const activeJobId = (pipelineResults?.[base + 1]?.[1] as string) ?? null;
    const oldestArr = (pipelineResults?.[base + 2]?.[1] as string[]) ?? [];
    const newestArr = (pipelineResults?.[base + 3]?.[1] as string[]) ?? [];
    const isBlocked = (pipelineResults?.[base + 4]?.[1] as number) === 1;
    const activeKeyTtlSec = (pipelineResults?.[base + 5]?.[1] as number) ?? -2;

    const oldestJobMs = oldestArr.length >= 2 ? parseFloat(oldestArr[1]!) : null;
    const newestJobMs = newestArr.length >= 2 ? parseFloat(newestArr[1]!) : null;

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
        } catch (err) {
          console.warn(
            JSON.stringify({
              level: "warn",
              msg: "Failed to parse job data",
              groupId,
              error: err instanceof Error ? err.message : "Parse error",
            }),
          );
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
      errorTimestamp: errorInfo?.timestamp ? parseFloat(errorInfo.timestamp) : null,
      retryCount: parseRetryCount(firstJobIds[i]!.jobId),
      activeKeyTtlSec: activeKeyTtlSec > 0 ? activeKeyTtlSec : null,
      processingDurationMs: null, // Cannot compute without knowing configured TTL
    });
  }

  groups.sort((a, b) => b.pendingJobs - a.pendingJobs);

  // Sum pending jobs from sampled groups (approximate when > SUMMARY_TOP_N groups exist)
  let totalPendingJobs = 0;
  for (const g of groups) {
    totalPendingJobs += g.pendingJobs;
  }

  return {
    name: queueName,
    displayName,
    pendingGroupCount: readyCount,
    blockedGroupCount: blockedCount,
    activeGroupCount,
    totalPendingJobs,
    groups,
  };
}

import type IORedis from "ioredis";
import type { GroupInfo, QueueInfo } from "../../shared/types.ts";
import { stripHashTag } from "./queueDiscovery.ts";

/** Max groups to fetch per queue during the periodic 2s collection cycle.
 *  Covers the dashboard table (default 25 shown) and pipeline tree metadata. */
const SUMMARY_TOP_N = 200;

/**
 * Lua script that sums score² across all members of a sorted set.
 * Scores are sqrt(pendingJobs), so sum(score²) ≈ totalPendingJobs.
 * Runs server-side in Redis — only transfers the final number.
 */
const SUM_SCORE_SQUARED_LUA = `
local members = redis.call('ZRANGE', KEYS[1], 0, -1, 'WITHSCORES')
local total = 0
for i = 2, #members, 2 do
  local s = tonumber(members[i])
  total = total + math.floor(s * s + 0.5)
end
return total
`;

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

  // O(1) counts + top N members by score (highest pending first) + blocked members
  const [readyCount, topReadyMembers, blockedMembers, totalPendingJobs] = await Promise.all([
    redis.zcard(readyKey),
    redis.zrevrange(readyKey, offset, offset + limit - 1, "WITHSCORES"),
    redis.smembers(blockedKey),
    // Lua script sums score² server-side to approximate totalPendingJobs without transferring 400K entries
    redis.eval(SUM_SCORE_SQUARED_LUA, 1, readyKey) as Promise<number>,
  ]);

  const blockedSet = new Set(blockedMembers);

  // Build the set of group IDs we'll fetch details for: top N ready + all blocked
  const groupIds = new Set<string>();
  const readyScores = new Map<string, number>();
  for (let i = 0; i < topReadyMembers.length; i += 2) {
    const groupId = topReadyMembers[i]!;
    const score = parseFloat(topReadyMembers[i + 1]!);
    groupIds.add(groupId);
    readyScores.set(groupId, score);
  }

  // Include blocked groups that aren't already in the ready sample
  for (const groupId of blockedMembers) {
    groupIds.add(groupId);
  }

  const groupIdArr = Array.from(groupIds);

  // Pipeline 1: Core group data (only for sampled groups, not all 400K)
  const CMDS_PER_GROUP = 4;
  const pipeline = redis.pipeline();
  for (const groupId of groupIdArr) {
    const jobsKey = `${prefix}group:${groupId}:jobs`;
    const activeKey = `${prefix}group:${groupId}:active`;
    pipeline.zcard(jobsKey);
    pipeline.get(activeKey);
    pipeline.zrange(jobsKey, 0, 0, "WITHSCORES");   // oldest + its ID
    pipeline.zrange(jobsKey, -1, -1, "WITHSCORES");  // newest
  }
  // Fetch error info only for blocked groups
  for (const groupId of blockedMembers) {
    pipeline.hgetall(`${prefix}group:${groupId}:error`);
  }

  const pipelineResults = await pipeline.exec();

  // Extract error info (results come after all group commands)
  const errorResultsBase = groupIdArr.length * CMDS_PER_GROUP;
  const groupErrors = new Map<string, { message: string; stack: string; timestamp: string }>();
  for (let i = 0; i < blockedMembers.length; i++) {
    const errorHash = pipelineResults?.[errorResultsBase + i]?.[1] as Record<string, string> | null;
    if (errorHash && errorHash.message) {
      groupErrors.set(blockedMembers[i]!, {
        message: errorHash.message,
        stack: errorHash.stack ?? "",
        timestamp: errorHash.timestamp ?? "",
      });
    }
  }

  // Collect first job IDs from the oldest ZRANGE result
  const firstJobIds: Array<{ groupId: string; jobId: string | null }> = [];
  for (let i = 0; i < groupIdArr.length; i++) {
    const base = i * CMDS_PER_GROUP;
    const oldestArr = (pipelineResults?.[base + 2]?.[1] as string[]) ?? [];
    firstJobIds.push({
      groupId: groupIdArr[i]!,
      jobId: oldestArr[0] ?? null,
    });
  }

  // Pipeline 2: Fetch metadata from first job's data hash
  const dataPipeline = redis.pipeline();
  let dataFetchCount = 0;
  for (const { groupId, jobId } of firstJobIds) {
    if (jobId) {
      const dataKey = `${prefix}group:${groupId}:data`;
      dataPipeline.hget(dataKey, jobId);
      dataFetchCount++;
    }
  }
  const dataResults = dataFetchCount > 0 ? await dataPipeline.exec() : [];

  let dataIdx = 0;
  const groups: GroupInfo[] = [];
  let activeGroupCount = 0;

  for (let i = 0; i < groupIdArr.length; i++) {
    const groupId = groupIdArr[i]!;
    const base = i * CMDS_PER_GROUP;

    const pendingJobs = (pipelineResults?.[base]?.[1] as number) ?? 0;
    const activeJobId = (pipelineResults?.[base + 1]?.[1] as string) ?? null;
    const oldestArr = (pipelineResults?.[base + 2]?.[1] as string[]) ?? [];
    const newestArr = (pipelineResults?.[base + 3]?.[1] as string[]) ?? [];

    const oldestJobMs = oldestArr.length >= 2 ? parseFloat(oldestArr[1]!) : null;
    const newestJobMs = newestArr.length >= 2 ? parseFloat(newestArr[1]!) : null;
    const isBlocked = blockedSet.has(groupId);

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
    });
  }

  groups.sort((a, b) => b.pendingJobs - a.pendingJobs);

  return {
    name: queueName,
    displayName,
    pendingGroupCount: readyCount,
    blockedGroupCount: blockedMembers.length,
    activeGroupCount,
    totalPendingJobs: Number(totalPendingJobs),
    groups,
  };
}

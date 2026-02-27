import type IORedis from "ioredis";
import type { GroupInfo, QueueInfo } from "../../shared/types.ts";
import { stripHashTag } from "./queueDiscovery.ts";

export async function scanGroupQueues(
  redis: IORedis,
  groupQueueNames: string[],
): Promise<QueueInfo[]> {
  // Process all queues concurrently instead of sequentially
  const queues = await Promise.all(
    groupQueueNames.map((queueName) => scanSingleQueue(redis, queueName)),
  );

  queues.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return queues;
}

async function scanSingleQueue(redis: IORedis, queueName: string): Promise<QueueInfo> {
  const displayName = stripHashTag(queueName);
  const prefix = `${queueName}:gq:`;

  const readyKey = `${prefix}ready`;
  const blockedKey = `${prefix}blocked`;

  const [readyMembers, blockedMembers] = await Promise.all([
    redis.zrange(readyKey, 0, -1, "WITHSCORES"),
    redis.smembers(blockedKey),
  ]);

  const blockedSet = new Set(blockedMembers);

  const groupIds = new Set<string>();
  const readyScores = new Map<string, number>();
  for (let i = 0; i < readyMembers.length; i += 2) {
    const groupId = readyMembers[i]!;
    const score = parseFloat(readyMembers[i + 1]!);
    groupIds.add(groupId);
    readyScores.set(groupId, score);
  }

  for (const groupId of blockedMembers) {
    groupIds.add(groupId);
  }

  const groupIdArr = Array.from(groupIds);
  const pipeline = redis.pipeline();
  for (const groupId of groupIdArr) {
    const jobsKey = `${prefix}group:${groupId}:jobs`;
    const activeKey = `${prefix}group:${groupId}:active`;
    pipeline.zcard(jobsKey);
    pipeline.get(activeKey);
    pipeline.zrange(jobsKey, 0, 0, "WITHSCORES");
    pipeline.zrange(jobsKey, -1, -1, "WITHSCORES");
    // Sample first job's data for pipeline metadata
    pipeline.zrange(jobsKey, 0, 0);
  }

  const pipelineResults = await pipeline.exec();

  // Batch fetch data for first jobs
  const firstJobIds: Array<{ groupId: string; jobId: string | null }> = [];
  for (let i = 0; i < groupIdArr.length; i++) {
    const base = i * 5;
    const firstJobArr = (pipelineResults?.[base + 4]?.[1] as string[]) ?? [];
    firstJobIds.push({
      groupId: groupIdArr[i]!,
      jobId: firstJobArr[0] ?? null,
    });
  }

  // Pipeline fetch job data for metadata sampling
  const dataPipeline = redis.pipeline();
  for (const { groupId, jobId } of firstJobIds) {
    if (jobId) {
      const dataKey = `${prefix}group:${groupId}:data`;
      dataPipeline.hget(dataKey, jobId);
    }
  }
  const dataResults = jobId_count(firstJobIds) > 0 ? await dataPipeline.exec() : [];

  let dataIdx = 0;
  const groups: GroupInfo[] = [];
  for (let i = 0; i < groupIdArr.length; i++) {
    const groupId = groupIdArr[i]!;
    const base = i * 5;

    const pendingJobs = (pipelineResults?.[base]?.[1] as number) ?? 0;
    const activeJobId = (pipelineResults?.[base + 1]?.[1] as string) ?? null;
    const oldestArr = (pipelineResults?.[base + 2]?.[1] as string[]) ?? [];
    const newestArr = (pipelineResults?.[base + 3]?.[1] as string[]) ?? [];

    const oldestJobMs = oldestArr.length >= 2 ? parseFloat(oldestArr[1]!) : null;
    const newestJobMs = newestArr.length >= 2 ? parseFloat(newestArr[1]!) : null;
    const isBlocked = blockedSet.has(groupId);

    // Extract pipeline metadata from first job's data
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
          console.warn(`Failed to parse job data for group ${groupId}:`, err);
        }
      }
    }

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
    });
  }

  groups.sort((a, b) => b.pendingJobs - a.pendingJobs);

  return {
    name: queueName,
    displayName,
    pendingGroupCount: groups.filter((g) => g.pendingJobs > 0).length,
    blockedGroupCount: groups.filter((g) => g.isBlocked).length,
    activeGroupCount: groups.filter((g) => g.hasActiveJob).length,
    totalPendingJobs: groups.reduce((sum, g) => sum + g.pendingJobs, 0),
    groups,
  };
}

function jobId_count(items: Array<{ jobId: string | null }>): number {
  return items.filter((i) => i.jobId !== null).length;
}

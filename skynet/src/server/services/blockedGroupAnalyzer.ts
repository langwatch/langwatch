import type IORedis from "ioredis";
import type { ErrorCluster, BlockedSummary } from "../../shared/types.ts";

const SSCAN_BATCH = 500;

export function normalizeErrorMessage(msg: string): string {
  return msg
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<UUID>")
    .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, "<IP>")
    .replace(/:\d{2,5}\b/g, ":<PORT>")
    .replace(/\b\d{10,}\b/g, "<ID>")
    .replace(/\s+/g, " ")
    .trim();
}

export async function analyzeBlockedGroups({
  redis,
  queueNames,
}: {
  redis: IORedis;
  queueNames: string[];
}): Promise<BlockedSummary> {
  let totalBlocked = 0;
  const clusterMap = new Map<string, ErrorCluster>();

  for (const queueName of queueNames) {
    const prefix = `${queueName}:gq:`;
    const blockedKey = `${prefix}blocked`;

    let cursor = "0";
    do {
      const [nextCursor, members] = await redis.sscan(blockedKey, cursor, "COUNT", SSCAN_BATCH);
      cursor = nextCursor;
      totalBlocked += members.length;

      if (members.length === 0) continue;

      // Pipeline: fetch error hash + first job data for each blocked group
      const pipeline = redis.pipeline();
      for (const groupId of members) {
        pipeline.hgetall(`${prefix}group:${groupId}:error`);
        pipeline.zrange(`${prefix}group:${groupId}:jobs`, 0, 0);
      }
      const results = await pipeline.exec();

      // Pipeline 2: fetch job data for pipeline name extraction
      const jobDataPipeline = redis.pipeline();
      const jobDataRequests: { groupId: string; jobId: string }[] = [];
      for (let i = 0; i < members.length; i++) {
        const jobArr = (results?.[i * 2 + 1]?.[1] as string[]) ?? [];
        if (jobArr[0]) {
          jobDataPipeline.hget(`${prefix}group:${members[i]!}:data`, jobArr[0]);
          jobDataRequests.push({ groupId: members[i]!, jobId: jobArr[0] });
        }
      }
      const jobDataResults = jobDataRequests.length > 0 ? await jobDataPipeline.exec() : [];

      // Build a map of groupId -> pipelineName
      const pipelineNames = new Map<string, string>();
      for (let i = 0; i < jobDataRequests.length; i++) {
        const raw = jobDataResults?.[i]?.[1] as string | null;
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            if (parsed.__pipelineName) {
              pipelineNames.set(jobDataRequests[i]!.groupId, parsed.__pipelineName);
            }
          } catch {
            // Ignore parse errors
          }
        }
      }

      for (let i = 0; i < members.length; i++) {
        const groupId = members[i]!;
        const errorHash = results?.[i * 2]?.[1] as Record<string, string> | null;
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
            sampleGroupIds: [groupId],
          });
        }
      }
    } while (cursor !== "0");
  }

  const clusters = Array.from(clusterMap.values()).sort((a, b) => b.count - a.count);

  return { totalBlocked, clusters };
}

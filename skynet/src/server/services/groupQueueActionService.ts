import type IORedis from "ioredis";
import { DRAIN_GROUP_LUA, UNBLOCK_LUA, MOVE_TO_DLQ_LUA, REPLAY_FROM_DLQ_LUA } from "./luaScripts.ts";
import { createLogger } from "../logger.ts";
import { DLQ_TTL_SECONDS } from "../../shared/constants.ts";

const logger = createLogger("groupQueueActions");

export class GroupQueueActionService {
  constructor(
    private readonly redis: IORedis,
    private readonly getGroupQueueNames: () => string[],
  ) {}

  isKnownQueue(queueName: string): boolean {
    return this.getGroupQueueNames().includes(queueName);
  }

  async unblockGroup({
    queueName,
    groupId,
  }: {
    queueName: string;
    groupId: string;
  }): Promise<{ wasBlocked: boolean }> {
    const prefix = `${queueName}:gq:`;
    const result = await this.redis.eval(
      UNBLOCK_LUA, 6,
      `${prefix}blocked`,
      `${prefix}group:${groupId}:active`,
      `${prefix}group:${groupId}:jobs`,
      `${prefix}ready`,
      `${prefix}signal`,
      `${prefix}group:${groupId}:error`,
      groupId,
    );

    return { wasBlocked: result === 1 };
  }

  async unblockAll({
    queueName,
  }: {
    queueName: string;
  }): Promise<{ unblockedCount: number }> {
    const prefix = `${queueName}:gq:`;
    const blockedKey = `${prefix}blocked`;
    let unblockedCount = 0;

    let cursor = "0";
    do {
      const [nextCursor, members] = await this.redis.sscan(blockedKey, cursor, "COUNT", 500);
      cursor = nextCursor;

      if (members.length === 0) continue;

      const pipeline = this.redis.pipeline();
      for (const groupId of members) {
        pipeline.eval(
          UNBLOCK_LUA, 6,
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

  async drainGroup({
    queueName,
    groupId,
  }: {
    queueName: string;
    groupId: string;
  }): Promise<{ jobsRemoved: number }> {
    const prefix = `${queueName}:gq:`;
    const result = await this.redis.eval(
      DRAIN_GROUP_LUA, 8,
      `${prefix}group:${groupId}:jobs`,
      `${prefix}group:${groupId}:data`,
      `${prefix}group:${groupId}:active`,
      `${prefix}ready`,
      `${prefix}blocked`,
      `${prefix}signal`,
      `${prefix}group:${groupId}:error`,
      `${prefix}stats:total-pending`,
      groupId,
    );

    return { jobsRemoved: Number(result) };
  }

  async retryBlocked({
    queueName,
    groupId,
    jobId,
  }: {
    queueName: string;
    groupId: string;
    jobId: string;
  }): Promise<{ wasBlocked: boolean }> {
    const { wasBlocked } = await this.unblockGroup({ queueName, groupId });

    return { wasBlocked };
  }

  async pauseKey({
    queueName,
    pauseKey,
  }: {
    queueName: string;
    pauseKey: string;
  }): Promise<void> {
    await this.redis.sadd(`${queueName}:gq:paused-jobs`, pauseKey);
  }

  async unpauseKey({
    queueName,
    pauseKey,
  }: {
    queueName: string;
    pauseKey: string;
  }): Promise<void> {
    await this.redis.srem(`${queueName}:gq:paused-jobs`, pauseKey);
    await this.redis.lpush(`${queueName}:gq:signal`, "1");
  }

  async listPausedKeys({
    queueName,
  }: {
    queueName: string;
  }): Promise<string[]> {
    return this.redis.smembers(`${queueName}:gq:paused-jobs`);
  }

  private async filterBlockedGroups({
    prefix,
    members,
    pipelineFilter,
    errorFilter,
  }: {
    prefix: string;
    members: string[];
    pipelineFilter?: string;
    errorFilter?: string;
  }): Promise<string[]> {
    const filterPipeline = this.redis.pipeline();
    for (const groupId of members) {
      filterPipeline.hgetall(`${prefix}group:${groupId}:error`);
      filterPipeline.zrange(`${prefix}group:${groupId}:jobs`, 0, 0);
    }
    const filterResults = await filterPipeline.exec();

    const jobDataPipeline = this.redis.pipeline();
    const jobDataMap = new Map<string, number>();
    let jobFetchIdx = 0;
    for (let i = 0; i < members.length; i++) {
      const jobArr = (filterResults?.[i * 2 + 1]?.[1] as string[]) ?? [];
      if (jobArr[0]) {
        jobDataPipeline.hget(`${prefix}group:${members[i]!}:data`, jobArr[0]);
        jobDataMap.set(members[i]!, jobFetchIdx++);
      }
    }
    const jobDataResults = jobFetchIdx > 0 ? await jobDataPipeline.exec() : [];

    return members.filter((groupId, i) => {
      if (errorFilter) {
        const errorHash = filterResults?.[i * 2]?.[1] as Record<string, string> | null;
        const msg = errorHash?.message ?? "";
        if (!msg.toLowerCase().includes(errorFilter.toLowerCase())) return false;
      }
      if (pipelineFilter) {
        const fetchIdx = jobDataMap.get(groupId);
        if (fetchIdx !== undefined) {
          const raw = jobDataResults?.[fetchIdx]?.[1] as string | null;
          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              if (parsed.__pipelineName !== pipelineFilter) return false;
            } catch {
              return false;
            }
          } else return false;
        } else return false;
      }
      return true;
    });
  }

  async drainAllBlocked({
    queueName,
    pipelineFilter,
    errorFilter,
  }: {
    queueName: string;
    pipelineFilter?: string;
    errorFilter?: string;
  }): Promise<{ drainedCount: number; jobsRemoved: number }> {
    const prefix = `${queueName}:gq:`;
    const blockedKey = `${prefix}blocked`;
    let drainedCount = 0;
    let jobsRemoved = 0;
    const hasFilters = !!pipelineFilter || !!errorFilter;

    let cursor = "0";
    do {
      const [nextCursor, members] = await this.redis.sscan(blockedKey, cursor, "COUNT", 500);
      cursor = nextCursor;

      if (members.length === 0) continue;

      const groupsToDrain = hasFilters
        ? await this.filterBlockedGroups({ prefix, members, pipelineFilter, errorFilter })
        : members;

      if (groupsToDrain.length === 0) continue;

      const drainPipeline = this.redis.pipeline();
      for (const groupId of groupsToDrain) {
        drainPipeline.eval(
          DRAIN_GROUP_LUA, 8,
          `${prefix}group:${groupId}:jobs`,
          `${prefix}group:${groupId}:data`,
          `${prefix}group:${groupId}:active`,
          `${prefix}ready`,
          `${prefix}blocked`,
          `${prefix}signal`,
          `${prefix}group:${groupId}:error`,
          `${prefix}stats:total-pending`,
          groupId,
        );
      }
      const results = await drainPipeline.exec();
      if (results) {
        for (const [err, result] of results) {
          if (!err) {
            const removed = Number(result);
            if (removed >= 0) {
              drainedCount++;
              jobsRemoved += removed;
            }
          }
        }
      }
    } while (cursor !== "0");

    return { drainedCount, jobsRemoved };
  }

  async drainAllBlockedPreview({
    queueName,
    pipelineFilter,
    errorFilter,
  }: {
    queueName: string;
    pipelineFilter?: string;
    errorFilter?: string;
  }): Promise<{ totalAffected: number; byPipeline: { name: string; count: number }[]; byError: { message: string; count: number }[] }> {
    const prefix = `${queueName}:gq:`;
    const blockedKey = `${prefix}blocked`;
    let totalAffected = 0;
    const pipelineCounts = new Map<string, number>();
    const errorCounts = new Map<string, number>();

    let cursor = "0";
    do {
      const [nextCursor, members] = await this.redis.sscan(blockedKey, cursor, "COUNT", 500);
      cursor = nextCursor;

      if (members.length === 0) continue;

      // Fetch error + first job for each
      const pipeline = this.redis.pipeline();
      for (const groupId of members) {
        pipeline.hgetall(`${prefix}group:${groupId}:error`);
        pipeline.zrange(`${prefix}group:${groupId}:jobs`, 0, 0);
      }
      const results = await pipeline.exec();

      // Fetch job data for pipeline names
      const jobDataPipeline = this.redis.pipeline();
      const jobDataRequests: { groupId: string; idx: number }[] = [];
      for (let i = 0; i < members.length; i++) {
        const jobArr = (results?.[i * 2 + 1]?.[1] as string[]) ?? [];
        if (jobArr[0]) {
          jobDataPipeline.hget(`${prefix}group:${members[i]!}:data`, jobArr[0]);
          jobDataRequests.push({ groupId: members[i]!, idx: i });
        }
      }
      const jobDataResults = jobDataRequests.length > 0 ? await jobDataPipeline.exec() : [];

      const groupPipelines = new Map<string, string>();
      for (let j = 0; j < jobDataRequests.length; j++) {
        const raw = jobDataResults?.[j]?.[1] as string | null;
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            if (parsed.__pipelineName) {
              groupPipelines.set(jobDataRequests[j]!.groupId, parsed.__pipelineName);
            }
          } catch {}
        }
      }

      for (let i = 0; i < members.length; i++) {
        const groupId = members[i]!;
        const errorHash = results?.[i * 2]?.[1] as Record<string, string> | null;
        const msg = errorHash?.message ?? "Unknown error";
        const pName = groupPipelines.get(groupId) ?? "unknown";

        if (errorFilter && !msg.toLowerCase().includes(errorFilter.toLowerCase())) continue;
        if (pipelineFilter && pName !== pipelineFilter) continue;

        totalAffected++;
        pipelineCounts.set(pName, (pipelineCounts.get(pName) ?? 0) + 1);

        const normalizedMsg = msg.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<UUID>")
          .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, "<IP>")
          .replace(/\s+/g, " ").trim();
        errorCounts.set(normalizedMsg, (errorCounts.get(normalizedMsg) ?? 0) + 1);
      }
    } while (cursor !== "0");

    return {
      totalAffected,
      byPipeline: Array.from(pipelineCounts.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      byError: Array.from(errorCounts.entries()).map(([message, count]) => ({ message, count })).sort((a, b) => b.count - a.count),
    };
  }

  async canaryUnblock({
    queueName,
    count = 5,
    pipelineFilter,
  }: {
    queueName: string;
    count?: number;
    pipelineFilter?: string;
  }): Promise<{ unblockedCount: number; groupIds: string[] }> {
    const prefix = `${queueName}:gq:`;
    const blockedKey = `${prefix}blocked`;

    // Get random blocked groups
    const candidates = await this.redis.srandmember(blockedKey, count * 3);
    if (!candidates || candidates.length === 0) return { unblockedCount: 0, groupIds: [] };

    let groupsToUnblock = candidates;

    if (pipelineFilter) {
      // Fetch job data to check pipeline
      const pipeline = this.redis.pipeline();
      for (const groupId of candidates) {
        pipeline.zrange(`${prefix}group:${groupId}:jobs`, 0, 0);
      }
      const jobIdResults = await pipeline.exec();

      const dataPipeline = this.redis.pipeline();
      const dataRequests: { groupId: string }[] = [];
      for (let i = 0; i < candidates.length; i++) {
        const jobArr = (jobIdResults?.[i]?.[1] as string[]) ?? [];
        if (jobArr[0]) {
          dataPipeline.hget(`${prefix}group:${candidates[i]!}:data`, jobArr[0]);
          dataRequests.push({ groupId: candidates[i]! });
        }
      }
      const dataResults = dataRequests.length > 0 ? await dataPipeline.exec() : [];

      const matchingGroups = new Set<string>();
      for (let i = 0; i < dataRequests.length; i++) {
        const raw = dataResults?.[i]?.[1] as string | null;
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            if (parsed.__pipelineName === pipelineFilter) {
              matchingGroups.add(dataRequests[i]!.groupId);
            }
          } catch {}
        }
      }
      groupsToUnblock = candidates.filter((id) => matchingGroups.has(id));
    }

    groupsToUnblock = groupsToUnblock.slice(0, count);
    if (groupsToUnblock.length === 0) return { unblockedCount: 0, groupIds: [] };

    const unblockPipeline = this.redis.pipeline();
    for (const groupId of groupsToUnblock) {
      unblockPipeline.eval(
        UNBLOCK_LUA, 6,
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

  async unblockAllBatched({
    queueName,
    batchSize = 500,
    delayMs: rawDelayMs = 100,
    onProgress,
  }: {
    queueName: string;
    batchSize?: number;
    delayMs?: number;
    onProgress?: (progress: { processed: number; total: number }) => void;
  }): Promise<{ unblockedCount: number }> {
    const MAX_DELAY_MS = 30_000;
    const delayMs = Math.min(Math.max(0, rawDelayMs), MAX_DELAY_MS);
    const prefix = `${queueName}:gq:`;
    const blockedKey = `${prefix}blocked`;

    const total = await this.redis.scard(blockedKey);
    let unblockedCount = 0;
    let processed = 0;

    let cursor = "0";
    do {
      const [nextCursor, members] = await this.redis.sscan(blockedKey, cursor, "COUNT", batchSize);
      cursor = nextCursor;

      if (members.length === 0) continue;

      const pipeline = this.redis.pipeline();
      for (const groupId of members) {
        pipeline.eval(
          UNBLOCK_LUA, 6,
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

      processed += members.length;
      onProgress?.({ processed, total });

      if (cursor !== "0" && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    } while (cursor !== "0");

    return { unblockedCount };
  }

  async moveToDlq({
    queueName,
    groupId,
  }: {
    queueName: string;
    groupId: string;
  }): Promise<{ jobsMoved: number }> {
    const prefix = `${queueName}:gq:`;
    const result = await this.redis.eval(
      MOVE_TO_DLQ_LUA, 11,
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
    return { jobsMoved: Number(result) };
  }

  async moveAllBlockedToDlq({
    queueName,
    pipelineFilter,
    errorFilter,
  }: {
    queueName: string;
    pipelineFilter?: string;
    errorFilter?: string;
  }): Promise<{ movedCount: number; jobsMoved: number }> {
    const prefix = `${queueName}:gq:`;
    const blockedKey = `${prefix}blocked`;
    let movedCount = 0;
    let jobsMoved = 0;
    const hasFilters = !!pipelineFilter || !!errorFilter;

    let cursor = "0";
    do {
      const [nextCursor, members] = await this.redis.sscan(blockedKey, cursor, "COUNT", 500);
      cursor = nextCursor;

      if (members.length === 0) continue;

      const groupsToMove = hasFilters
        ? await this.filterBlockedGroups({ prefix, members, pipelineFilter, errorFilter })
        : members;

      if (groupsToMove.length === 0) continue;

      const pipeline = this.redis.pipeline();
      for (const groupId of groupsToMove) {
        pipeline.eval(
          MOVE_TO_DLQ_LUA, 11,
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

  async canaryRedrive({
    queueName,
    count = 5,
  }: {
    queueName: string;
    count?: number;
  }): Promise<{ redrivenCount: number; groupIds: string[] }> {
    const prefix = `${queueName}:gq:`;
    const dlqIndexKey = `${prefix}dlq`;

    const dlqSize = await this.redis.scard(dlqIndexKey);
    logger.info({ message: "canaryRedrive start", context: { dlqSize, requestedCount: count } });
    if (dlqSize === 0) return { redrivenCount: 0, groupIds: [] };

    const candidates = await this.redis.srandmember(dlqIndexKey, Math.min(count, dlqSize));
    if (!candidates || candidates.length === 0) return { redrivenCount: 0, groupIds: [] };

    const validCandidates = candidates.filter((id): id is string => id !== null);

    const pipeline = this.redis.pipeline();
    for (const groupId of validCandidates) {
      pipeline.eval(
        REPLAY_FROM_DLQ_LUA, 8,
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
    let zeroJobCount = 0;
    let errorCount = 0;
    const redrivenIds: string[] = [];
    if (results) {
      for (let i = 0; i < results.length; i++) {
        const [err, result] = results[i]!;
        if (err) {
          errorCount++;
          logger.error({ message: "canaryRedrive REPLAY error", context: { groupId: validCandidates[i], error: err.message } });
        } else if (Number(result) > 0) {
          redrivenCount++;
          redrivenIds.push(validCandidates[i]!);
        } else {
          zeroJobCount++;
        }
      }
    }

    logger.info({ message: "canaryRedrive done", context: { redrivenCount, zeroJobCount, errorCount, totalCandidates: validCandidates.length } });
    return { redrivenCount, groupIds: redrivenIds };
  }

  async replayFromDlq({
    queueName,
    groupId,
  }: {
    queueName: string;
    groupId: string;
  }): Promise<{ jobsReplayed: number }> {
    const prefix = `${queueName}:gq:`;
    const result = await this.redis.eval(
      REPLAY_FROM_DLQ_LUA, 8,
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
    return { jobsReplayed: Number(result) };
  }

  async replayAllFromDlq({
    queueName,
  }: {
    queueName: string;
  }): Promise<{ replayedCount: number; jobsReplayed: number }> {
    const prefix = `${queueName}:gq:`;
    const dlqIndexKey = `${prefix}dlq`;
    let replayedCount = 0;
    let jobsReplayed = 0;

    let cursor = "0";
    do {
      const [nextCursor, members] = await this.redis.sscan(dlqIndexKey, cursor, "COUNT", 500);
      cursor = nextCursor;

      if (members.length === 0) continue;

      const pipeline = this.redis.pipeline();
      for (const groupId of members) {
        pipeline.eval(
          REPLAY_FROM_DLQ_LUA, 8,
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
}

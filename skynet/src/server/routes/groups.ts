import { Router } from "express";
import type IORedis from "ioredis";
import type { MetricsCollector } from "../services/metricsCollector.ts";
import { stripHashTag } from "../services/queueDiscovery.ts";
import { getCompletedJobsForGroup } from "../services/bullmqService.ts";
import { analyzeBlockedGroups } from "../services/blockedGroupAnalyzer.ts";

export function createGroupsRouter(redis: IORedis, metrics: MetricsCollector, getGroupQueueNames: () => string[]): Router {
  const router = Router();

  router.get("/api/groups", async (req, res) => {
    try {
      const queues = metrics.getLatestQueues();
      res.json({ queues });
    } catch (err) {
      console.error("Groups fetch error:", err);
      res.status(500).json({ error: "Failed to fetch groups" });
    }
  });

  router.get("/api/blocked-summary", async (req, res) => {
    try {
      const summary = await analyzeBlockedGroups({ redis, queueNames: getGroupQueueNames() });
      res.json(summary);
    } catch (err) {
      console.error("Blocked summary error:", err);
      res.status(500).json({ error: "Failed to compute blocked summary" });
    }
  });

  router.get("/api/blocked-groups/export", async (req, res) => {
    try {
      const queueName = req.query.queueName as string | undefined;
      const format = (req.query.format as string) ?? "json";
      if (!queueName) {
        res.status(400).json({ error: "queueName query param is required" });
        return;
      }

      const prefix = `${queueName}:gq:`;
      const blockedKey = `${prefix}blocked`;
      const groups: Array<{ groupId: string; errorMessage: string; errorStack: string; errorTimestamp: string; pipelineName: string | null }> = [];

      let cursor = "0";
      do {
        const [nextCursor, members] = await redis.sscan(blockedKey, cursor, "COUNT", 500);
        cursor = nextCursor;

        if (members.length === 0) continue;

        const pipeline = redis.pipeline();
        for (const groupId of members) {
          pipeline.hgetall(`${prefix}group:${groupId}:error`);
          pipeline.zrange(`${prefix}group:${groupId}:jobs`, 0, 0);
        }
        const results = await pipeline.exec();

        const jobDataPipeline = redis.pipeline();
        const jobDataRequests: { groupId: string }[] = [];
        for (let i = 0; i < members.length; i++) {
          const jobArr = (results?.[i * 2 + 1]?.[1] as string[]) ?? [];
          if (jobArr[0]) {
            jobDataPipeline.hget(`${prefix}group:${members[i]!}:data`, jobArr[0]);
            jobDataRequests.push({ groupId: members[i]! });
          }
        }
        const jobDataResults = jobDataRequests.length > 0 ? await jobDataPipeline.exec() : [];

        const pipelineNames = new Map<string, string>();
        for (let j = 0; j < jobDataRequests.length; j++) {
          const raw = jobDataResults?.[j]?.[1] as string | null;
          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              if (parsed.__pipelineName) pipelineNames.set(jobDataRequests[j]!.groupId, parsed.__pipelineName);
            } catch {}
          }
        }

        for (let i = 0; i < members.length; i++) {
          const groupId = members[i]!;
          const errorHash = results?.[i * 2]?.[1] as Record<string, string> | null;
          groups.push({
            groupId,
            errorMessage: errorHash?.message ?? "",
            errorStack: errorHash?.stack ?? "",
            errorTimestamp: errorHash?.timestamp ?? "",
            pipelineName: pipelineNames.get(groupId) ?? null,
          });
        }
      } while (cursor !== "0");

      if (format === "csv") {
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", "attachment; filename=blocked-groups.csv");
        const sanitize = (val: string) => {
          const escaped = val.replace(/"/g, '""');
          // Prevent CSV injection: prefix formula-triggering chars with a single quote
          if (/^[=+\-@\t\r]/.test(escaped)) return `'${escaped}`;
          return escaped;
        };
        const header = "groupId,pipelineName,errorMessage,errorTimestamp\n";
        const rows = groups.map((g) =>
          `"${sanitize(g.groupId)}","${sanitize(g.pipelineName ?? "")}","${sanitize(g.errorMessage)}","${sanitize(g.errorTimestamp)}"`
        ).join("\n");
        res.send(header + rows);
      } else {
        res.json({ groups });
      }
    } catch (err) {
      console.error("Export blocked groups error:", err);
      res.status(500).json({ error: "Failed to export blocked groups" });
    }
  });

  router.get("/api/groups/:groupId", async (req, res) => {
    const { groupId } = req.params;
    const queueName = req.query.queue as string | undefined;

    // First try the cached data from the metrics collector
    const queues = metrics.getLatestQueues();

    for (const queue of queues) {
      if (queueName && queue.name !== queueName) continue;
      const group = queue.groups.find((g) => g.groupId === groupId);
      if (group) {
        res.json({
          groupId: group.groupId,
          queueName: queue.name,
          displayName: queue.displayName,
          pendingJobs: group.pendingJobs,
          hasActiveJob: group.hasActiveJob,
          activeJobId: group.activeJobId,
          isBlocked: group.isBlocked,
          isStaleBlock: group.isStaleBlock,
          pipelineName: group.pipelineName,
          jobType: group.jobType,
          jobName: group.jobName,
          errorMessage: group.errorMessage,
          errorStack: group.errorStack,
          errorTimestamp: group.errorTimestamp,
          retryCount: group.retryCount ?? null,
        });
        return;
      }
    }

    // Fall back to a live Redis lookup when the group isn't in cache
    // (race condition: SSE showed group at time T, user clicked at T+3s,
    // cache refreshed and group may have completed/drained)
    if (queueName) {
      try {
        const prefix = `${queueName}:gq:`;
        const jobsKey = `${prefix}group:${groupId}:jobs`;
        const activeKey = `${prefix}group:${groupId}:active`;
        const blockedKey = `${prefix}blocked`;
        const errorKey = `${prefix}group:${groupId}:error`;

        const [pendingJobs, activeJobId, blockedMembers, errorHash] = await Promise.all([
          redis.zcard(jobsKey),
          redis.get(activeKey),
          redis.smembers(blockedKey),
          redis.hgetall(errorKey),
        ]);

        const isBlocked = blockedMembers.includes(groupId);

        // If the group has pending jobs, an active job, or is blocked, it still exists
        if (pendingJobs > 0 || activeJobId || isBlocked) {
          res.json({
            groupId,
            queueName,
            displayName: stripHashTag(queueName),
            pendingJobs,
            hasActiveJob: activeJobId !== null,
            activeJobId,
            isBlocked,
            isStaleBlock: isBlocked && pendingJobs === 0 && activeJobId === null,
            pipelineName: null,
            jobType: null,
            jobName: null,
            errorMessage: errorHash?.message ?? null,
            errorStack: errorHash?.stack ?? null,
            errorTimestamp: errorHash?.timestamp ? parseFloat(errorHash.timestamp) : null,
            retryCount: null,
          });
          return;
        }
      } catch (err) {
        console.error("Live Redis lookup failed for group:", groupId, err);
      }
    }

    // Group has genuinely completed/drained — try to find completed BullMQ jobs
    if (queueName) {
      try {
        const completedJobs = await getCompletedJobsForGroup(redis, queueName, groupId);
        if (completedJobs.length > 0) {
          res.json({
            groupId,
            queueName,
            displayName: stripHashTag(queueName),
            pendingJobs: 0,
            hasActiveJob: false,
            activeJobId: null,
            isBlocked: false,
            isStaleBlock: false,
            pipelineName: null,
            jobType: null,
            jobName: null,
            errorMessage: null,
            errorStack: null,
            errorTimestamp: null,
            retryCount: null,
            status: "completed",
            completedJobs,
          });
          return;
        }
      } catch (err) {
        console.error("Completed jobs lookup failed for group:", groupId, err);
      }
    }

    res.status(404).json({ error: "Group not found", status: "completed" });
  });

  return router;
}

import { Router } from "express";
import type IORedis from "ioredis";
import type { MetricsCollector } from "../services/metricsCollector.ts";
import { stripHashTag } from "../services/queueDiscovery.ts";
import { getCompletedJobsForGroup } from "../services/bullmqService.ts";

export function createGroupsRouter(redis: IORedis, metrics: MetricsCollector, getGroupQueueNames: () => string[]): Router {
  const router = Router();

  router.get("/api/groups", (_req, res) => {
    const queues = metrics.getLatestQueues();
    res.json({ queues });
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

        const [pendingJobs, activeJobId, blockedMembers] = await Promise.all([
          redis.zcard(jobsKey),
          redis.get(activeKey),
          redis.smembers(blockedKey),
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

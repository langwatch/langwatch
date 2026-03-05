import { Router } from "express";
import type IORedis from "ioredis";
import type { JobInfo } from "../../shared/types.ts";
import { JOBS_PAGE_SIZE } from "../../shared/constants.ts";

export function createJobsRouter(redis: IORedis, getGroupQueueNames: () => string[]): Router {
  const router = Router();

  router.get("/api/groups/:groupId/jobs", async (req, res) => {
    const { groupId } = req.params;
    const queueName = req.query.queue as string | undefined;
    const page = parseInt(req.query.page as string ?? "0", 10);

    if (!queueName) {
      res.status(400).json({ error: "queue parameter is required" });
      return;
    }

    const groupQueueNames = getGroupQueueNames();
    if (!groupQueueNames.includes(queueName)) {
      res.status(404).json({ error: "Unknown queue name" });
      return;
    }

    const prefix = `${queueName}:gq:`;
    const jobsKey = `${prefix}group:${groupId}:jobs`;
    const dataKey = `${prefix}group:${groupId}:data`;

    const start = page * JOBS_PAGE_SIZE;
    const end = start + JOBS_PAGE_SIZE - 1;

    const [jobsWithScores, totalJobs] = await Promise.all([
      redis.zrange(jobsKey, start, end, "WITHSCORES"),
      redis.zcard(jobsKey),
    ]);

    // Extract job IDs from the paginated result
    const jobIds: string[] = [];
    for (let i = 0; i < jobsWithScores.length; i += 2) {
      jobIds.push(jobsWithScores[i]!);
    }

    // Use HMGET with just the paginated job IDs instead of HGETALL
    const jobDataValues = jobIds.length > 0
      ? await redis.hmget(dataKey, ...jobIds)
      : [];

    const jobs: JobInfo[] = [];
    for (let i = 0; i < jobsWithScores.length; i += 2) {
      const stagedJobId = jobsWithScores[i]!;
      const dispatchAfter = parseFloat(jobsWithScores[i + 1]!);
      let data: Record<string, unknown> | null = null;

      const dataIndex = i / 2;
      const rawData = jobDataValues[dataIndex];
      if (rawData) {
        try {
          data = JSON.parse(rawData);
        } catch (err) {
          console.warn(`Failed to parse job data for ${stagedJobId}:`, err);
          data = null;
        }
      }
      jobs.push({ stagedJobId, dispatchAfter, data });
    }

    jobs.sort((a, b) => a.dispatchAfter - b.dispatchAfter);

    res.json({
      jobs,
      total: totalJobs,
      page,
      pageSize: JOBS_PAGE_SIZE,
      totalPages: Math.ceil(totalJobs / JOBS_PAGE_SIZE),
    });
  });

  return router;
}

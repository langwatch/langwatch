import * as Sentry from "@sentry/nextjs";
import { type Job, Worker } from "bullmq";
import type { UsageStatsJob } from "~/server/background/types";
import { createLogger } from "../../../utils/logger";
import { connection } from "../../redis";
import { USAGE_STATS_QUEUE_NAME } from "../queues/usageStatsQueue";
import {
  getJobProcessingCounter,
  getJobProcessingDurationHistogram,
} from "../../metrics";
import { collectUsageStats } from "~/server/collectUsageStats";

const logger = createLogger("langwatch:workers:usageStatsWorker");

export async function runUsageStatsJob(job: Job<UsageStatsJob, void, string>) {
  if (process.env.DISABLE_USAGE_STATS || process.env.IS_SAAS !== "true") {
    logger.info("usage stats disabled, skipping job");
    return;
  }

  logger.info({ jobId: job.id, data: job.data }, "processing usage stats job");
  getJobProcessingCounter("usage_stats", "processing").inc();
  const start = Date.now();

  const stats = await collectUsageStats(job.data.instance_id);

  try {
    const installMethod = process.env.INSTALL_METHOD || "self-hosted"; // Default to self-hosted if not specified

    fetch("http://localhost:5560/api/track_usage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "daily_usage_stats",
        install_method: installMethod,
        hostname: process.env.BASE_HOST,
        environment: process.env.NODE_ENV,
        instance_id: job.data.instance_id,
        ...stats,
      }),
    }).catch((error) => {
      logger.error({ error }, "Failed to send usage stats");
    });

    getJobProcessingCounter("usage_stats", "completed").inc();
    const duration = Date.now() - start;
    getJobProcessingDurationHistogram("usage_stats").observe(duration);
  } catch (error) {
    getJobProcessingCounter("usage_stats", "failed").inc();
    logger.error({ jobId: job.id, error }, "failed to process usage stats job");
    Sentry.withScope((scope) => {
      scope.setTag("worker", "usageStats");
      scope.setExtra("job", job.data);
      Sentry.captureException(error);
    });
    throw error;
  }
}

export const startUsageStatsWorker = () => {
  if (!connection) {
    logger.info("no redis connection, skipping usage stats worker");
    return;
  }

  const usageStatsWorker = new Worker<UsageStatsJob, void, string>(
    USAGE_STATS_QUEUE_NAME,
    runUsageStatsJob,
    {
      connection,
      concurrency: 1, // Only one job at a time since it's a daily task
    }
  );

  usageStatsWorker.on("ready", () => {
    logger.info("usage stats worker active, waiting for jobs!");
  });

  usageStatsWorker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, error: err.message }, "job failed");
    getJobProcessingCounter("usage_stats", "failed").inc();
    Sentry.withScope((scope) => {
      scope.setTag("worker", "usageStats");
      scope.setExtra("job", job?.data);
      Sentry.captureException(err);
    });
  });

  logger.info("usage stats worker registered");
  return usageStatsWorker;
};

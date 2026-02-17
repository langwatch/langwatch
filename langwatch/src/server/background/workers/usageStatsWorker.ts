import { type Job, Worker } from "bullmq";
import { createWorkerTelemetry } from "../bullmqTelemetry";
import { env } from "~/env.mjs";
import type { UsageStatsJob } from "~/server/background/types";
import { withJobContext } from "../../context/asyncContext";
import { collectUsageStats } from "~/server/collectUsageStats";
import { createLogger } from "../../../utils/logger/server";
import {
  captureException,
  withScope,
} from "../../../utils/posthogErrorCapture";
import {
  recordJobWaitDuration,
  getJobProcessingCounter,
  getJobProcessingDurationHistogram,
} from "../../metrics";
import { connection } from "../../redis";
import { USAGE_STATS_QUEUE } from "../queues/usageStatsQueue";

const logger = createLogger("langwatch:workers:usageStatsWorker");

export async function runUsageStatsJob(job: Job<UsageStatsJob, void, string>) {
  if (env.DISABLE_USAGE_STATS || env.IS_SAAS) {
    logger.info("usage stats disabled, skipping job");
    return;
  }

  recordJobWaitDuration(job, "usage_stats");
  logger.info({ jobId: job.id, data: job.data }, "processing usage stats job");
  getJobProcessingCounter("usage_stats", "processing").inc();
  const start = Date.now();

  try {
    const stats = await collectUsageStats(job.data.instance_id);

    const installMethod = process.env.INSTALL_METHOD || "self-hosted"; // Default to self-hosted if not specified

    fetch("https://app.langwatch.ai/api/track_usage", {
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
    await withScope(async (scope) => {
      scope.setTag?.("worker", "usageStats");
      scope.setExtra?.("job", job.data);
      captureException(error);
    });
  }
}

export const startUsageStatsWorker = () => {
  if (env.DISABLE_USAGE_STATS || env.IS_SAAS) {
    logger.info("usage stats disabled, skipping job");
    return;
  }

  if (!connection) {
    logger.info("no redis connection, skipping usage stats worker");
    return;
  }

  const usageStatsWorker = new Worker<UsageStatsJob, void, string>(
    USAGE_STATS_QUEUE.NAME,
    withJobContext(runUsageStatsJob),
    {
      connection,
      concurrency: 1, // Only one job at a time since it's a daily task
      telemetry: createWorkerTelemetry(USAGE_STATS_QUEUE.NAME),
    },
  );

  usageStatsWorker.on("ready", () => {
    logger.info("usage stats worker active, waiting for jobs!");
  });

  usageStatsWorker.on("failed", async (job, err) => {
    logger.error({ jobId: job?.id, error: err.message }, "job failed");
    getJobProcessingCounter("usage_stats", "failed").inc();
    await withScope((scope) => {
      scope.setTag?.("worker", "usageStats");
      scope.setExtra?.("job", job?.data);
      captureException(err);
    });
  });

  logger.info("usage stats worker registered");
  return usageStatsWorker;
};

import type { UsageStatsJob } from "~/server/background/types";
import { connection } from "../../redis";
import { QueueWithFallback } from "./queueWithFallback";
import { runUsageStatsJob } from "../workers/usageStatsWorker";
import type { ConnectionOptions } from "bullmq";
import { prisma } from "../../db";
import { createLogger } from "../../../utils/logger";

const logger = createLogger("langwatch:usageStatsQueue");

export const USAGE_STATS_QUEUE_NAME = "usage_stats";

export const usageStatsQueue = new QueueWithFallback<
  UsageStatsJob,
  void,
  string
>(USAGE_STATS_QUEUE_NAME, runUsageStatsJob, {
  connection: connection as ConnectionOptions,
  defaultJobOptions: {
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    attempts: 3,
    removeOnComplete: {
      age: 0, // immediately remove completed jobs
    },
    removeOnFail: {
      age: 60 * 60 * 24 * 3, // 3 days
    },
  },
});

export const scheduleUsageStats = async () => {
  const yyyymmdd = new Date().toISOString().split("T")[0];

  // Get all organizations
  const organizations = await prisma.organization.findMany({
    select: {
      id: true,
      name: true,
    },
  });

  if (organizations.length === 0) {
    logger.error("No organizations found");
    return;
  }

  // Create a job for each organization
  const results = await Promise.allSettled(
    organizations.map(async (organization) => {
      const instanceId = `${organization.name}__${organization.id}`;
      logger.info({ instanceId }, "Scheduling usage stats for organization");

      return await usageStatsQueue.add(
        "usage_stats",
        {
          instance_id: instanceId,
          timestamp: Date.now(),
        },
        {
          jobId: `usage_stats_${instanceId}_${yyyymmdd}`,
          repeat: {
            pattern: "0 0 * * *", // Run at midnight every day
          },
        }
      );
    })
  );

  // Log any failures
  const failures = results.filter((r) => r.status === "rejected");
  if (failures.length > 0) {
    logger.error(
      { count: failures.length, total: organizations.length },
      "Failed to schedule some usage stats jobs"
    );
  }
};

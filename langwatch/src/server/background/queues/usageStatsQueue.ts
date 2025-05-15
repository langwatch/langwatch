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

  console.log({ organizations });

  // Create a job for each organization
  await Promise.all(
    organizations.map(async (organization) => {
      const instanceId = `${organization.name}__${organization.id}`;
      console.log({ instanceId });

      await usageStatsQueue.add(
        "usage_stats",
        {
          instance_id: instanceId,
          timestamp: Date.now(),
        },
        {
          jobId: `usage_stats_${instanceId}_${yyyymmdd}`,
          repeat: {
            pattern: "* * * * *", // Run every minute for testing
          },
        }
      );
    })
  );
};

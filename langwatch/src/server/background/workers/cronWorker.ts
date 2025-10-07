import { createLogger } from "../../../utils/logger";
import { env } from "~/env.mjs";

const logger = createLogger("langwatch:workers:cronWorker");

// Import the actual functions from the cron endpoints
import { scheduleTopicClustering } from "~/server/background/queues/topicClusteringQueue";
import { runTriggers } from "~/pages/api/cron/triggers";

// Direct function calls for cron tasks
async function runTopicClusteringTask() {
  logger.info("Running topic clustering task");
  try {
    await scheduleTopicClustering();
    logger.info("Topic clustering task completed successfully");
  } catch (error) {
    logger.error({ error }, "Topic clustering task failed");
    throw error;
  }
}

async function runTriggersTask() {
  logger.info("Running triggers task");
  try {
    await runTriggers();
    logger.info("Triggers task completed successfully");
  } catch (error) {
    logger.error({ error }, "Triggers task failed");
    throw error;
  }
}

// Cron job definitions
const cronJobs = [
  {
    name: "topic-clustering",
    schedule: "0 2 * * *", // Daily at 2 AM
    run: runTopicClusteringTask,
    description: "Schedule topic clustering tasks",
  },
  {
    name: "triggers",
    schedule: "*/3 * * * *", // Every 3 minutes
    run: runTriggersTask,
    description: "Check and fire alert triggers",
  },
];

// Simple cron scheduler using setInterval
function scheduleCronJob(job: (typeof cronJobs)[0]) {
  const [minute, hour] = job.schedule.split(" ");

  // Convert cron schedule to milliseconds
  // This is a simplified implementation - for production you'd want a proper cron parser
  let intervalMs: number;

  if (minute?.startsWith("*/")) {
    // Every N minutes
    const minutes = parseInt(minute?.substring(2) ?? "0");
    intervalMs = minutes * 60 * 1000;
  } else if (minute === "0" && hour !== "*") {
    // Daily at specific hour
    const targetHour = parseInt(hour ?? "0");
    const now = new Date();
    const targetTime = new Date();
    targetTime.setHours(targetHour, 0, 0, 0);

    if (targetTime <= now) {
      targetTime.setDate(targetTime.getDate() + 1);
    }

    intervalMs = targetTime.getTime() - now.getTime();
  } else {
    // Default to every hour for other patterns
    intervalMs = 60 * 60 * 1000;
  }

  logger.info(
    {
      job: job.name,
      schedule: job.schedule,
      intervalMs: intervalMs / 60000,
    },
    "Scheduling cron job"
  );

  const runJob = () => {
    void (async () => {
      try {
        logger.info({ job: job.name }, "Starting cron job");
        await job.run();
        logger.info({ job: job.name }, "Cron job completed successfully");
      } catch (error) {
        logger.error({ job: job.name, error }, "Cron job failed");
      }
    })();
  };

  // Run immediately if it's the right time, otherwise schedule it
  const now = new Date();
  const [currentHour] = [now.getMinutes(), now.getHours()];

  if (minute === "0" && hour !== "*" && parseInt(hour ?? "0") === currentHour) {
    // Run now if it's the scheduled hour
    runJob();
  }

  // Schedule the recurring job
  setInterval(runJob, intervalMs);
}

export const startCronWorker = () => {
  if (!env.ENABLE_CRON_TASKS) {
    logger.info("Cron tasks disabled, skipping cron worker");
    return;
  }

  logger.info("Starting cron worker");

  // Schedule all cron jobs
  cronJobs.forEach(scheduleCronJob);

  logger.info({ jobCount: cronJobs.length }, "Cron worker started with jobs");
};

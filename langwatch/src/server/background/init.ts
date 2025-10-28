import { createLogger } from "../../utils/logger";
import { startUsageStatsWorker } from "./workers/usageStatsWorker";
import { scheduleUsageStats } from "./queues/usageStatsQueue";
import { startCronWorker } from "./workers/cronWorker";
import { env } from "~/env.mjs";

const logger = createLogger("langwatch:background:init");

export const initializeBackgroundWorkers = async () => {
  try {
    // Initialize usage stats worker
    const usageStatsWorker = startUsageStatsWorker();
    if (usageStatsWorker) {
      logger.info("Usage stats worker initialized");

      // Schedule initial usage stats collection
      if (!env.IS_SAAS && !env.DISABLE_USAGE_STATS) {
        logger.info("Scheduling initial usage stats collection");
        await scheduleUsageStats().catch((error) => {
          logger.error({ error }, "Failed to schedule usage stats collection");
        });
      }
    }

    // Initialize cron worker
    startCronWorker();

    // Add other background worker initializations here as needed
  } catch (error) {
    logger.error({ error }, "Failed to initialize background workers");
    throw error;
  }
};

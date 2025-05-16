import { createLogger } from "../../utils/logger";
import { startUsageStatsWorker } from "./workers/usageStatsWorker";
import { scheduleUsageStats } from "./queues/usageStatsQueue";

const logger = createLogger("langwatch:background:init");

export const initializeBackgroundWorkers = async () => {
  try {
    // Initialize usage stats worker
    const usageStatsWorker = startUsageStatsWorker();
    if (usageStatsWorker) {
      logger.info("Usage stats worker initialized");

      // Schedule initial usage stats collection
      if (
        process.env.IS_SAAS !== "true" &&
        process.env.DISABLE_USAGE_STATS !== "true"
      ) {
        logger.info("Scheduling initial usage stats collection");
        await scheduleUsageStats().catch((error) => {
          logger.error({ error }, "Failed to schedule usage stats collection");
        });
      }
    }

    // Add other background worker initializations here as needed
  } catch (error) {
    logger.error({ error }, "Failed to initialize background workers");
    throw error;
  }
};

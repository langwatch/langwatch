import "dotenv/config";
import { setEnvironment } from "@langwatch/ksuid";
import { verifyRedisReady } from "./server/redis";
import { createLogger } from "./utils/logger/server";

setEnvironment(process.env.ENVIRONMENT ?? "local");

const { initializeWorkerApp } = require("./server/app-layer/presets") as {
  initializeWorkerApp: () => void;
};
initializeWorkerApp();

const logger = createLogger("langwatch:workers");

logger.info("starting");

void verifyRedisReady().then(async () => {
  try {
    const { startIngestionPullerWorker } = await import(
      "@ee/governance/services/pullers/pullerWorker"
    );
    const { scheduleIngestionPullers } = await import(
      "@ee/governance/services/pullers/pullerQueue"
    );
    startIngestionPullerWorker();
    await scheduleIngestionPullers();
    logger.info("ingestion puller worker ready");

    const { startTopicClusteringWorker } = await import(
      "./server/topicClustering/topicClusteringWorker"
    );
    startTopicClusteringWorker();
    logger.info("topic clustering worker ready");
  } catch (error) {
    logger.error({ error }, "failed to start background workers");
    process.exit(1);
  }
});

process.on("uncaughtException", (err) => {
  logger.fatal({ error: err }, "uncaught exception detected");
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  logger.fatal(
    { reason: reason instanceof Error ? reason : { value: reason }, promise },
    "unhandled rejection detected",
  );
});

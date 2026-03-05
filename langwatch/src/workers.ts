import { setEnvironment } from "@langwatch/ksuid";
import { loadEnvConfig } from "@next/env";
import { WorkersRestart } from "./server/background/errors";
import { createLogger } from "./utils/logger/server";

loadEnvConfig(process.cwd());
setEnvironment(process.env.ENVIRONMENT ?? "local");

const { initializeWorkerApp } = require("./server/app-layer/presets") as {
  initializeWorkerApp: () => void;
};
initializeWorkerApp();

const logger = createLogger("langwatch:workers");

logger.info("starting");

// eslint-disable-next-line @typescript-eslint/no-var-requires
require("./server/background/worker")
  .start(void 0, 15 * 60 * 1000)
  .catch((error: Error) => {
    if (error instanceof WorkersRestart) {
      logger.info({ error }, "worker restart");
      process.exit(0);
    }

    logger.error({ error }, "error running worker");
    process.exit(1);
  });

// Global error handlers for uncaught exceptions and unhandled promise rejections
process.on("uncaughtException", (err) => {
  logger.fatal({ error: err }, "uncaught exception detected");

  // Attempt graceful shutdown, abort if it takes too long
  const { gracefulShutdown } = require("./server/background/worker");
  Promise.race([
    gracefulShutdown(),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Shutdown timeout")), 3000)),
  ])
    .catch(() => process.abort())
    .finally(() => process.exit(1));
});

process.on("unhandledRejection", (reason, promise) => {
  logger.fatal(
    { reason: reason instanceof Error ? reason : { value: reason }, promise },
    "unhandled rejection detected",
  );
});

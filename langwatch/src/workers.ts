import { loadEnvConfig } from "@next/env";
import { createLogger } from "./utils/logger";

loadEnvConfig(process.cwd());

const { WorkersRestart } = require("./server/background/worker");
const logger = createLogger("langwatch:workers");

logger.info("starting");

// eslint-disable-next-line @typescript-eslint/no-var-requires
require("./server/background/worker")
  .start(undefined, 5 * 60 * 1000)
  .catch((error: Error) => {
    if (error instanceof WorkersRestart) {
      logger.info({ error }, "worker restart");
      process.exit(0);
    }

    logger.error({ error }, "error running worker");
    process.exit(1);
  });

// Global error handlers for uncaught exceptions and unhandled promise rejections
process.on('uncaughtException', (err) => {
  logger.fatal({ error: err }, 'uncaught exception detected');

  // If a graceful shutdown is not achieved after 1 second,
  // shut down the process completely
  setTimeout(() => {
    process.abort(); // exit immediately and generate a core dump file
  }, 1000).unref();
});

process.on('unhandledRejection', (reason, promise) => {
  logger.fatal({ reason: reason instanceof Error ? reason : { value: reason }, promise }, 'unhandled rejection detected');
});

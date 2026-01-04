import { loadEnvConfig } from "@next/env";
import { WorkersRestart } from "./server/background/errors";
import { createLogger } from "./utils/logger";
import { setEnvironment } from "@langwatch/ksuid";

loadEnvConfig(process.cwd());
setEnvironment(process.env.ENVIRONMENT ?? "local");

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

  // If a graceful shutdown is not achieved after 3 seconds,
  // shut down the process completely
  setTimeout(() => {
    process.abort(); // exit immediately and generate a core dump file
  }, 3000).unref();
});

process.on("unhandledRejection", (reason, promise) => {
  logger.fatal(
    { reason: reason instanceof Error ? reason : { value: reason }, promise },
    "unhandled rejection detected",
  );
});

import "dotenv/config";
import { setEnvironment } from "@langwatch/ksuid";
import { WorkersRestart } from "./server/background/errors";
import { verifyRedisReady } from "./server/redis";
import { createLogger } from "./utils/logger/server";
setEnvironment(process.env.ENVIRONMENT ?? "local");

const { initializeWorkerApp } = require("./server/app-layer/presets") as {
  initializeWorkerApp: () => void;
};
initializeWorkerApp();

const logger = createLogger("langwatch:workers");

logger.info("starting");

// Self-restart cadence: by default the worker exits cleanly every 15 min
// (memory-leak safety pattern) and an external supervisor (helm/docker)
// brings it back up immediately. In environments without that supervisor
// (e.g. `npx @langwatch/server`, where supervise() in spawn.ts doesn't
// restart-on-exit), set `LANGWATCH_WORKERS_MAX_RUNTIME_MS=0` to disable
// the timer and run forever. A non-numeric / unset value keeps the legacy
// 15-min default so helm/docker behavior is unchanged.
const maxRuntimeMsRaw = process.env.LANGWATCH_WORKERS_MAX_RUNTIME_MS;
const maxRuntimeMs =
  maxRuntimeMsRaw !== undefined && maxRuntimeMsRaw !== ""
    ? Number(maxRuntimeMsRaw)
    : 15 * 60 * 1000;

// Fail fast if Redis isn't reachable — BullMQ would otherwise reconnect
// forever and jobs silently pile up in queues we can't even read.
void verifyRedisReady().then(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require("./server/background/worker")
    .start(void 0, maxRuntimeMs)
    .catch((error: Error) => {
      if (error instanceof WorkersRestart) {
        logger.info({ error }, "worker restart");
        process.exit(0);
      }

      logger.error({ error }, "error running worker");
      process.exit(1);
    });
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

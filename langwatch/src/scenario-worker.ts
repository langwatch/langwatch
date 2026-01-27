/**
 * Scenario worker entry point (for independent deployment).
 *
 * Currently, scenario processing runs as part of the main workers process.
 * This separate entry point exists for future independent scaling if scenarios
 * need dedicated resources or isolation.
 *
 * OTEL trace isolation is handled at the child process level - each scenario
 * spawns its own process with an independent tracer context, so running in
 * the main workers process doesn't affect trace isolation.
 *
 * @see https://github.com/langwatch/langwatch/issues/1088
 */

import { setEnvironment } from "@langwatch/ksuid";
import { loadEnvConfig } from "@next/env";
import { createLogger } from "./utils/logger";

// NOTE: We intentionally do NOT import instrumentation.node.ts here.
// OTEL isolation is handled per-scenario via createScenarioTracer() in the processor.

loadEnvConfig(process.cwd());
setEnvironment(process.env.ENVIRONMENT ?? "local");

const logger = createLogger("langwatch:scenario-worker");

logger.info("Starting scenario worker");

// Import and start the processor after environment is configured
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { startScenarioProcessor } = require("./server/scenarios/scenario.processor");

const worker = startScenarioProcessor();

if (!worker) {
  logger.warn("Scenario processor not started (no Redis connection)");
  process.exit(0);
}

logger.info("Scenario worker started, waiting for jobs");

// Graceful shutdown handling
const shutdown = async () => {
  logger.info("Shutting down scenario worker");
  try {
    await worker.close();
    logger.info("Scenario worker shutdown complete");
    process.exit(0);
  } catch (error) {
    logger.error({ error }, "Error during shutdown");
    process.exit(1);
  }
};

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

// Global error handlers
process.on("uncaughtException", (err) => {
  logger.fatal({ error: err }, "Uncaught exception detected");
  setTimeout(() => {
    process.abort();
  }, 3000).unref();
});

process.on("unhandledRejection", (reason, promise) => {
  logger.fatal(
    { reason: reason instanceof Error ? reason : { value: reason }, promise },
    "Unhandled rejection detected",
  );
});

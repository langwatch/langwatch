import "dotenv/config";
// Portless (haven) overlay, loaded last with override exactly like
// server.mts: a standalone workers lane must resolve the same hostnames,
// ports and connection URLs as the app it serves, or the two halves of one
// stack quietly talk to different infrastructure.
import dotenv from "dotenv";
import { existsSync } from "fs";

dotenv.config({
  path: ".env.portless",
  override: true,
  quiet: process.env.NODE_ENV !== "development" || !existsSync(".env.portless"),
});
// OTel instrumentation MUST load before any module that creates spans —
// without it the worker process has no registered tracer provider and every
// BullMQOtel adapter / getLangWatchTracer span becomes a non-recording no-op.
// dotenv stays first so instrumentation.node sees .env-provided config
// (LANGWATCH_API_KEY, OTEL_EXPORTER_OTLP_ENDPOINT). Kept as the first import
// so its side effects run before the worker modules below evaluate.
import "./instrumentation.node";
// Registers the Grafana trace-link builder with @langwatch/handled-error.
import "./server/handled-error-wiring";
import { setEnvironment } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import { startWorkers, type WorkerHandle } from "./server/workers/startWorkers";

setEnvironment(process.env.ENVIRONMENT ?? "local");

// initializeWorkerApp loads the full app graph, which reads process.env at
// module load — it must run AFTER setEnvironment() above. A static import
// would hoist above that call and break env loading, so it's required here.
const { initializeWorkerApp } = require("./server/app-layer/presets") as {
  initializeWorkerApp: () => void;
};
initializeWorkerApp();

const logger = createLogger("langwatch:workers");

logger.info("starting");

let isShuttingDown = false;
let workerHandle: WorkerHandle | undefined;

async function gracefulShutdown(): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  try {
    await workerHandle?.shutdown();
  } catch (error) {
    logger.error({ error }, "error shutting down workers");
  }
  // Close the App (ClickHouse / Redis / Prisma) last, after the workers above
  // have stopped accepting and draining jobs.
  try {
    const { getApp } = await import("./server/app-layer/app");
    await getApp().close();
  } catch (error) {
    logger.error({ error }, "error closing app during shutdown");
  }
  process.exit(0);
}

process.on("SIGINT", () => void gracefulShutdown());
process.on("SIGTERM", () => void gracefulShutdown());

void startWorkers({ shouldStartMetricsServer: true })
  .then((handle) => {
    workerHandle = handle;
  })
  .catch((error) => {
    logger.error({ error }, "failed to start background workers");
    process.exit(1);
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

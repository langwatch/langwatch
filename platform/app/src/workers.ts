// Env files (.env + the .env.portless haven overlay) load as this import's
// side effect, BEFORE instrumentation and the app graph below evaluate — a
// standalone workers lane must resolve the same hostnames, ports and
// connection URLs as the app it serves, or the two halves of one stack
// quietly talk to different infrastructure. Must stay the first import: see
// src/env-load.ts for why inline dotenv.config() calls cannot do this.
import "./env-load";

// OTel instrumentation MUST load before any module that creates spans —
// without it the worker process has no registered tracer provider and every
// getLangWatchTracer span becomes a non-recording no-op.
// env-load stays first so instrumentation.node sees .env-provided config
// (LANGWATCH_API_KEY, OTEL_EXPORTER_OTLP_ENDPOINT).
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

/**
 * Hard deadline for the whole shutdown, below the pod's
 * terminationGracePeriodSeconds (60s, charts/langwatch/values.yaml).
 *
 * The phases below are individually bounded — App.close races its own drain
 * backstop — but workerHandle.shutdown() is not, and a shutdown that overruns
 * the grace period is answered with SIGKILL. Exiting slightly early on our own
 * terms means the reason is in the logs; SIGKILL leaves nothing at all.
 */
const SHUTDOWN_DEADLINE_MS = 45_000;

async function gracefulShutdown(): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  const deadline = setTimeout(() => {
    logger.error(
      { deadlineMs: SHUTDOWN_DEADLINE_MS },
      "graceful shutdown exceeded its deadline, exiting before the pod is killed",
    );
    process.exit(1);
  }, SHUTDOWN_DEADLINE_MS);
  // Never let the watchdog itself be the reason the process stays alive.
  deadline.unref();

  try {
    await workerHandle?.shutdown();
  } catch (error) {
    logger.error({ error }, "error shutting down workers");
  }
  // Close the App (ClickHouse / Redis / Prisma) last, after the workers above
  // have stopped accepting and draining jobs. App.close drains the queue
  // consumer BEFORE dropping those connections — closing them alongside a
  // running drain is what severed in-flight ClickHouse statements on every
  // rollout. See specs/event-sourcing/worker-graceful-shutdown.feature.
  try {
    const { getApp } = await import("./server/app-layer/app");
    await getApp().close();
  } catch (error) {
    logger.error({ error }, "error closing app during shutdown");
  }

  clearTimeout(deadline);
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

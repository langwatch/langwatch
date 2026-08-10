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
import { SHUTDOWN_BUDGET } from "./server/shutdown/budget";
import { installShutdownHandlers } from "./server/shutdown/runGracefulShutdown";
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

let workerHandle: WorkerHandle | undefined;

installShutdownHandlers((signal) => ({
  signal,
  logger,
  phases: [
    { name: "workers", run: async () => await workerHandle?.shutdown() },
    // The app phase carries the queue drain, so it gets the whole budget
    // rather than the default per-phase ceiling; App.close bounds it from
    // the inside.
    // The App (ClickHouse / Redis / Prisma) closes last, after the workers
    // above have stopped accepting jobs. App.close drains the queue consumer
    // BEFORE dropping those connections — closing them alongside a running
    // drain is what severed in-flight ClickHouse statements on every rollout.
    // See specs/event-sourcing/worker-graceful-shutdown.feature.
    {
      name: "app",
      timeoutMs: SHUTDOWN_BUDGET.processDeadlineMs,
      run: async () => {
        const { getApp } = await import("./server/app-layer/app");
        await getApp().close();
      },
    },
  ],
}));

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

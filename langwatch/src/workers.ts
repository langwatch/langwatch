import "dotenv/config";
import http from "http";
import { register } from "prom-client";
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

// Resources that hold OS-level handles — child processes, sockets, timers,
// Redis subscribers — and must be released on shutdown. Populated as each
// worker boots inside the `verifyRedisReady()` block below.
const shutdownHandles: Array<() => Promise<void> | void> = [];
let isShuttingDown = false;

async function gracefulShutdown(): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info({ count: shutdownHandles.length }, "shutting down workers");
  await Promise.allSettled(shutdownHandles.map((close) => close()));
  process.exit(0);
}

process.on("SIGINT", () => void gracefulShutdown());
process.on("SIGTERM", () => void gracefulShutdown());

// The worker/queue/app modules below construct Redis-connecting
// `QueueWithFallback` instances (or otherwise touch Redis) at load, and the
// app graph must load only after `setEnvironment()` above has run. They're
// therefore imported dynamically — only after `verifyRedisReady()` confirms the
// connection — to preserve that ordering. Keep them as `await import()` (not
// top-level) for that reason; `http`/`prom-client` are safe to import eagerly.
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

    // ClickHouse storage-stats collection (feeds the Ops storage metrics).
    const { getSharedClickHouseClient } = await import(
      "./server/clickhouse/clickhouseClient"
    );
    const { startStorageStatsCollection, stopStorageStatsCollection } =
      await import("./server/clickhouse/metrics");
    const clickHouseClient = getSharedClickHouseClient();
    if (clickHouseClient) {
      startStorageStatsCollection(clickHouseClient);
      shutdownHandles.push(() => stopStorageStatsCollection());
      logger.info("storage stats collection ready");
    }

    // Scenario simulation executor: an in-process pool late-bound into the
    // scenarioExecution reactor (runIn: ["worker"]). Without this the reactor
    // fires with no pool wired and simulations never execute.
    const { getScenarioExecutionHandle } = await import(
      "./server/app-layer/presets"
    );
    const { ScenarioExecutionPool } = await import(
      "./server/scenarios/execution/execution-pool"
    );
    const { startScenarioProcessor } = await import(
      "./server/scenarios/scenario.processor"
    );
    const { SCENARIO_WORKER } = await import(
      "./server/scenarios/scenario.constants"
    );
    const scenarioPool = new ScenarioExecutionPool({
      concurrency: SCENARIO_WORKER.CONCURRENCY,
    });
    getScenarioExecutionHandle()?.setPool(scenarioPool);
    const scenarioProcessor = await startScenarioProcessor(scenarioPool);
    if (scenarioProcessor) {
      shutdownHandles.push(() => scenarioProcessor.close());
    }
    logger.info("scenario processor ready");

    // Per-tenant enqueue-rate anomaly detector (surfaces runaway tenants on
    // the Ops page).
    const { startAnomalyWorker } = await import(
      "./server/observability/anomalyWorker"
    );
    const anomalyWorker = startAnomalyWorker();
    if (anomalyWorker) {
      shutdownHandles.push(() => anomalyWorker.stop());
      logger.info("anomaly worker ready");
    }

    // Expose the worker process's prom-client registry over HTTP so the web
    // process can scrape it at GET /workers/metrics (proxied in start.ts).
    const { getWorkerMetricsPort } = await import("./server/metrics");
    const metricsPort = getWorkerMetricsPort();
    const metricsServer = http.createServer((req, res) => {
      if (req.url === "/metrics") {
        res.setHeader("Content-Type", register.contentType);
        register
          .metrics()
          .then((metrics) => res.end(metrics))
          .catch((error) => {
            logger.error({ error }, "error getting worker metrics");
            res.writeHead(500).end();
          });
      } else {
        res.writeHead(404).end();
      }
    });
    metricsServer.listen(metricsPort, () => {
      logger.info(`worker metrics server listening on port ${metricsPort}`);
    });
    shutdownHandles.push(
      () =>
        new Promise<void>((resolve) => metricsServer.close(() => resolve())),
    );
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

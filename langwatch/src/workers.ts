import "dotenv/config";
// OTel instrumentation MUST load before any module that creates spans —
// without it the worker process has no registered tracer provider and every
// BullMQOtel adapter / getLangWatchTracer span becomes a non-recording no-op.
// dotenv stays first so instrumentation.node sees .env-provided config
// (LANGWATCH_API_KEY, OTEL_EXPORTER_OTLP_ENDPOINT).
import "./instrumentation.node";
import { setEnvironment } from "@langwatch/ksuid";
import http from "http";
import { register } from "prom-client";
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

// The worker/queue/app modules below construct Redis-connecting
// `QueueWithFallback` instances (or otherwise touch Redis) at load, and the
// app graph must load only after `setEnvironment()` above has run. They're
// therefore imported dynamically — only after `verifyRedisReady()` confirms the
// connection — to preserve that ordering. Keep them as `await import()` (not
// top-level) for that reason; `http`/`prom-client` are safe to import eagerly.
void verifyRedisReady().then(async () => {
  try {
    // Fail fast if the database is unreachable — better to crash the pod at
    // boot than to boot green and have every job fail individually.
    const { prisma } = await import("./server/db");
    try {
      await prisma.$queryRaw`SELECT 1`;
      logger.info("database connection verified");
    } catch (error) {
      logger.fatal({ error }, "database unreachable at boot");
      process.exit(1);
    }

    const { startIngestionPullerWorker } = await import(
      "@ee/governance/services/pullers/pullerWorker"
    );
    const { scheduleIngestionPullers } = await import(
      "@ee/governance/services/pullers/pullerQueue"
    );
    const ingestionPullerWorker = startIngestionPullerWorker();
    if (ingestionPullerWorker) {
      shutdownHandles.push(() => ingestionPullerWorker.close());
    }
    await scheduleIngestionPullers();
    logger.info("ingestion puller worker ready");

    const { startTopicClusteringWorker } = await import(
      "./server/topicClustering/topicClusteringWorker"
    );
    const topicClusteringWorker = startTopicClusteringWorker();
    if (topicClusteringWorker) {
      shutdownHandles.push(() => topicClusteringWorker.close());
    }
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

    // Langy turn executor (ADR-044): an in-process pool late-bound into the
    // spawnAgent reactor (runIn: ["worker"]). Mirrors the scenario block above.
    // The pool calls the Go langy-agent manager, bridges its NDJSON to the Redis
    // token buffer, and drives durable milestones + finalize. The processor also
    // boots the liveness reconcile sweep (deploy-survival backstop).
    const { getLangySpawnAgentHandle } = await import(
      "./server/app-layer/presets"
    );
    const { LangyWorkerPool } = await import(
      "./server/services/langy/execution/langy-worker-pool"
    );
    const { startLangyTurnProcessor } = await import(
      "./server/services/langy/execution/langy-turn.processor"
    );
    const { LANGY_WORKER } = await import(
      "./server/services/langy/streaming/langy.streaming.constants"
    );
    const langyPool = new LangyWorkerPool({
      concurrency: LANGY_WORKER.CONCURRENCY,
    });
    getLangySpawnAgentHandle()?.setPool(langyPool);
    const langyProcessor = await startLangyTurnProcessor(langyPool);
    if (langyProcessor) {
      shutdownHandles.push(() => langyProcessor.close());
    }
    logger.info("langy turn processor ready");

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

    // Governance spend-spike anomaly evaluation: a 5-minute tick that
    // evaluates admin-authored spend_spike rules and persists AnomalyAlert
    // rows (specs/ai-gateway/governance/anomaly-detection.feature).
    const { startSpendSpikeAnomalyWorker } = await import(
      "@ee/governance/services/spendSpikeAnomalyWorker"
    );
    const spendSpikeAnomalyWorker = startSpendSpikeAnomalyWorker();
    shutdownHandles.push(() => spendSpikeAnomalyWorker.stop());
    logger.info("spend spike anomaly worker ready");

    // Self-hosted daily usage telemetry (no-op on SaaS or when
    // DISABLE_USAGE_STATS is set).
    const { startUsageStatsWorker } = await import(
      "./server/usageStatsWorker"
    );
    const usageStatsWorker = startUsageStatsWorker();
    if (usageStatsWorker) {
      shutdownHandles.push(() => usageStatsWorker.stop());
      logger.info("usage stats worker ready");
    }

    // Expose the worker process's prom-client registry over HTTP so the web
    // process can scrape it at GET /workers/metrics (proxied in start.ts).
    const { getWorkerMetricsPort, isMetricsAuthorized } = await import(
      "./server/metrics"
    );
    const metricsPort = getWorkerMetricsPort();
    const metricsServer = http.createServer((req, res) => {
      if (req.url !== "/metrics") {
        res.writeHead(404).end();
        return;
      }
      try {
        if (!isMetricsAuthorized(req)) {
          res.writeHead(401).end();
          return;
        }
      } catch (error) {
        // Fail closed when METRICS_API_KEY is unset in production.
        logger.error({ error }, "worker metrics auth misconfigured");
        res.writeHead(500).end();
        return;
      }
      res.setHeader("Content-Type", register.contentType);
      register
        .metrics()
        .then((metrics) => res.end(metrics))
        .catch((error) => {
          logger.error({ error }, "error getting worker metrics");
          res.writeHead(500).end();
        });
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

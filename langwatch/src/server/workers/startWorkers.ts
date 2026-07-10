import http from "http";
import { register } from "prom-client";
import { verifyRedisReady } from "~/server/redis";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:workers");

export interface WorkerHandle {
  /**
   * Release every worker-held OS resource (child processes, sockets, timers,
   * Redis subscribers). Does NOT close the shared App (ClickHouse / Redis /
   * Prisma) — the caller owns the App lifecycle and closes it after this
   * resolves, so the in-process dev mode doesn't double-close the App the web
   * server is still using.
   */
  shutdown: () => Promise<void>;
}

export interface StartWorkersOptions {
  /**
   * Expose the worker prom-client registry over its own HTTP port. On for the
   * standalone worker deployment (the web process scrapes it at
   * `GET /workers/metrics`); off for the in-process dev mode, where the web
   * server already serves the shared registry at `/metrics`.
   */
  startMetricsServer?: boolean;
}

/**
 * Boots the background worker stack: ingestion pullers, topic clustering,
 * ClickHouse storage-stats collection, the scenario executor pool, the
 * enqueue-rate anomaly detector, the governance spend-spike detector, the
 * self-hosted usage-stats telemetry, and (optionally) the Prometheus metrics
 * HTTP server.
 *
 * Assumes the App has ALREADY been initialized by the caller with a
 * worker-capable role — `initializeWorkerApp()` for the standalone deployment,
 * or `initializeInProcessApp()` for the dev single-process mode. Registers NO
 * process signal handlers: the caller owns the process lifecycle and invokes
 * the returned `shutdown()` on teardown.
 *
 * The worker/queue/app modules below construct Redis-connecting
 * `QueueWithFallback` instances (or otherwise touch Redis) at module load, and
 * the app graph must evaluate only after `setEnvironment()` has run in the
 * entrypoint. They are therefore imported dynamically — a top-level static
 * `import` is hoisted above the entrypoint's `setEnvironment()` call and breaks
 * env loading. Keep them as `await import()` for that reason.
 */
export async function startWorkers(
  options?: StartWorkersOptions,
): Promise<WorkerHandle> {
  const startMetricsServer = options?.startMetricsServer ?? true;

  // Resources that hold OS-level handles — child processes, sockets, timers,
  // Redis subscribers — and must be released on shutdown. Populated as each
  // worker boots below.
  const shutdownHandles: Array<() => Promise<void> | void> = [];

  await verifyRedisReady();

  // Fail fast if the database is unreachable — better to fail the boot loudly
  // than to come up green and have every job fail individually.
  const { prisma } = await import("~/server/db");
  try {
    await prisma.$queryRaw`SELECT 1`;
    logger.info("database connection verified");
  } catch (error) {
    logger.fatal({ error }, "database unreachable at boot");
    throw error;
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
    "~/server/topicClustering/topicClusteringWorker"
  );
  const topicClusteringWorker = startTopicClusteringWorker();
  if (topicClusteringWorker) {
    shutdownHandles.push(() => topicClusteringWorker.close());
  }
  logger.info("topic clustering worker ready");

  // ClickHouse storage-stats collection (feeds the Ops storage metrics).
  const { getSharedClickHouseClient } = await import(
    "~/server/clickhouse/clickhouseClient"
  );
  const { startStorageStatsCollection, stopStorageStatsCollection } =
    await import("~/server/clickhouse/metrics");
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
    "~/server/app-layer/presets"
  );
  const { ScenarioExecutionPool } = await import(
    "~/server/scenarios/execution/execution-pool"
  );
  const { startScenarioProcessor } = await import(
    "~/server/scenarios/scenario.processor"
  );
  const { SCENARIO_WORKER } = await import(
    "~/server/scenarios/scenario.constants"
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
    "~/server/observability/anomalyWorker"
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
  const { startUsageStatsWorker } = await import("~/server/usageStatsWorker");
  const usageStatsWorker = startUsageStatsWorker();
  if (usageStatsWorker) {
    shutdownHandles.push(() => usageStatsWorker.stop());
    logger.info("usage stats worker ready");
  }

  if (startMetricsServer) {
    // Expose the worker process's prom-client registry over HTTP so the web
    // process can scrape it at GET /workers/metrics (proxied in start.ts). In
    // the in-process dev mode this is skipped — the web server serves the same
    // (shared) registry at /metrics directly.
    const { getWorkerMetricsPort, isMetricsAuthorized } = await import(
      "~/server/metrics"
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
      () => new Promise<void>((resolve) => metricsServer.close(() => resolve())),
    );
  }

  return {
    shutdown: async () => {
      logger.info({ count: shutdownHandles.length }, "shutting down workers");
      await Promise.allSettled(shutdownHandles.map((close) => close()));
    },
  };
}

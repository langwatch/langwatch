import { createLogger } from "@langwatch/observability";
import http from "http";
import { register } from "prom-client";
import { assertRedisReady } from "~/server/redis";

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
  shouldStartMetricsServer?: boolean;
}

type ShutdownHandles = Array<() => Promise<void> | void>;

// Fail fast if the database is unreachable — better to fail the boot loudly
// than to come up green and have every job fail individually.
async function verifyDatabaseReady(): Promise<void> {
  const { prisma } = await import("~/server/db");
  try {
    await prisma.$queryRaw`SELECT 1`;
    logger.info("database connection verified");
  } catch (error) {
    logger.fatal({ error }, "database unreachable at boot");
    throw error;
  }
}

async function bootIngestionPuller(): Promise<void> {
  const { reconcileIngestionPullSchedules } = await import(
    "@ee/governance/services/pullers/ingestionPullScheduler"
  );
  await reconcileIngestionPullSchedules();
  logger.info("ingestion pull calendar reconciled");
}

async function bootTopicClustering(
  shutdownHandles: ShutdownHandles,
): Promise<void> {
  const { startTopicClusteringWorker } = await import(
    "~/server/topicClustering/topicClusteringWorker"
  );
  const topicClusteringWorker = startTopicClusteringWorker();
  if (topicClusteringWorker) {
    shutdownHandles.push(() => topicClusteringWorker.close());
  }
  logger.info("topic clustering worker ready");
}

// ClickHouse storage-stats collection (feeds the Ops storage metrics).
async function bootStorageStatsCollection(
  shutdownHandles: ShutdownHandles,
): Promise<void> {
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
}

// Scenario simulation executor: an in-process pool late-bound into the
// scenarioExecution reactor (runIn: ["worker"]). Without this the reactor
// fires with no pool wired and simulations never execute.
async function bootScenarioProcessor(
  shutdownHandles: ShutdownHandles,
): Promise<void> {
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
}

// Per-tenant enqueue-rate anomaly detector (surfaces runaway tenants on
// the Ops page).
async function bootAnomalyWorker(
  shutdownHandles: ShutdownHandles,
): Promise<void> {
  const { startAnomalyWorker } = await import(
    "~/server/observability/anomalyWorker"
  );
  const anomalyWorker = startAnomalyWorker();
  if (anomalyWorker) {
    shutdownHandles.push(() => anomalyWorker.stop());
    logger.info("anomaly worker ready");
  }
}

// Governance spend-spike anomaly evaluation: a 5-minute tick that
// evaluates admin-authored spend_spike rules and persists AnomalyAlert
// rows (specs/ai-gateway/governance/anomaly-detection.feature).
async function bootSpendSpikeAnomalyWorker(
  shutdownHandles: ShutdownHandles,
): Promise<void> {
  const { startSpendSpikeAnomalyWorker } = await import(
    "@ee/governance/services/spendSpikeAnomalyWorker"
  );
  const spendSpikeAnomalyWorker = startSpendSpikeAnomalyWorker();
  shutdownHandles.push(() => spendSpikeAnomalyWorker.stop());
  logger.info("spend spike anomaly worker ready");
}

// Self-hosted daily usage telemetry (no-op on SaaS or when
// DISABLE_USAGE_STATS is set).
async function bootUsageStatsWorker(
  shutdownHandles: ShutdownHandles,
): Promise<void> {
  const { startUsageStatsWorker } = await import("~/server/usageStatsWorker");
  const usageStatsWorker = startUsageStatsWorker();
  if (usageStatsWorker) {
    shutdownHandles.push(() => usageStatsWorker.stop());
    logger.info("usage stats worker ready");
  }
}

// Expose the worker process's prom-client registry over HTTP so the web
// process can scrape it at GET /workers/metrics (proxied in start.ts). In
// the in-process dev mode this is skipped — the web server serves the same
// (shared) registry at /metrics directly.
async function bootMetricsServer(
  shutdownHandles: ShutdownHandles,
): Promise<void> {
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
  await new Promise<void>((resolve, reject) => {
    metricsServer.once("error", reject);
    metricsServer.listen(metricsPort, () => {
      metricsServer.removeListener("error", reject);
      logger.info(`worker metrics server listening on port ${metricsPort}`);
      resolve();
    });
  });
  shutdownHandles.push(
    () => new Promise<void>((resolve) => metricsServer.close(() => resolve())),
  );
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
 * Each boot stage below is a small helper that lazily imports its own
 * dependencies and pushes its own teardown onto `shutdownHandles`. The
 * worker/queue/app modules construct Redis-connecting `QueueWithFallback`
 * instances (or otherwise touch Redis) at module load, and the app graph must
 * evaluate only after `setEnvironment()` has run in the entrypoint. A
 * top-level static `import` is hoisted above the entrypoint's
 * `setEnvironment()` call and breaks env loading — keep every helper's
 * imports as `await import()` for that reason.
 */
export async function startWorkers(
  options?: StartWorkersOptions,
): Promise<WorkerHandle> {
  const shouldStartMetricsServer = options?.shouldStartMetricsServer ?? true;

  // Resources that hold OS-level handles — child processes, sockets, timers,
  // Redis subscribers — and must be released on shutdown. Populated as each
  // worker boots below.
  const shutdownHandles: ShutdownHandles = [];
  const closeRegisteredWorkers = async (): Promise<void> => {
    // Reverse order: later stages may depend on earlier ones (e.g. the
    // scenario processor depends on the pool it registered into), so tear
    // down newest-first.
    await Promise.allSettled(
      [...shutdownHandles].reverse().map((close) => close()),
    );
  };

  await assertRedisReady();
  await verifyDatabaseReady();

  try {
    await bootIngestionPuller();
    await bootTopicClustering(shutdownHandles);
    await bootStorageStatsCollection(shutdownHandles);
    await bootScenarioProcessor(shutdownHandles);
    await bootAnomalyWorker(shutdownHandles);
    await bootSpendSpikeAnomalyWorker(shutdownHandles);
    await bootUsageStatsWorker(shutdownHandles);
    if (shouldStartMetricsServer) {
      await bootMetricsServer(shutdownHandles);
    }
  } catch (error) {
    // A later stage failed after earlier stages already registered live
    // resources (child processes, timers, sockets) — close them before
    // rethrowing, or a partial boot failure leaks them silently.
    logger.error({ error }, "worker boot failed partway — rolling back");
    await closeRegisteredWorkers();
    throw error;
  }

  return {
    shutdown: async () => {
      logger.info({ count: shutdownHandles.length }, "shutting down workers");
      await closeRegisteredWorkers();
    },
  };
}

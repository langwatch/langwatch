import { createLogger } from "@langwatch/observability";
import type { IncomingMessage, RequestListener, ServerResponse } from "http";
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

// ClickHouse storage-stats collection (feeds the Ops storage metrics).
//
// Reads `system.parts` / `system.disks` / `system.backup_log` — facts about the
// deployment, not about any tenant — so it takes the infrastructure client
// rather than a resolver. The tenant wrapper is what turns the package client's
// positional rows back into the named rows this collector's SQL is written
// against, and what converts the UInt64 byte/row counts back to numbers.
async function bootStorageStatsCollection(
  shutdownHandles: ShutdownHandles,
): Promise<void> {
  const { getInfrastructureClickHouseClient } = await import(
    "~/server/app-layer/clients/clickhouse/shared"
  );
  const { tenantClickHouseClient } = await import(
    "~/server/app-layer/clients/clickhouse/tenant-client"
  );
  const { startStorageStatsCollection, stopStorageStatsCollection } =
    await import("~/server/clickhouse/metrics");
  const clickHouseClient = getInfrastructureClickHouseClient();
  if (clickHouseClient) {
    startStorageStatsCollection(
      tenantClickHouseClient({
        client: clickHouseClient,
        // Matches no organisation, so routing resolves it to the shared
        // endpoint — the one whose parts and disks these gauges describe.
        tenantId: "__infrastructure__",
      }),
    );
    shutdownHandles.push(() => stopStorageStatsCollection());
    logger.info("storage stats collection ready");
  }
}

// Scenario simulation executor: the registry of child processes this worker
// holds, late-bound into the `scenarioExecution` process outbox. Until it is
// bound, dispatches for this worker stay pending and are retried rather than
// dropped (ADR-073 step 2, retired; ground now ADR-103).
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
  const scenarioPool = new ScenarioExecutionPool();
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

/**
 * The worker's liveness path. Deliberately UNAUTHENTICATED and deliberately
 * not `/metrics`.
 *
 * The kubelet needs a path it can call with no credentials, because it has
 * neither of the two things `/metrics` demands. `/metrics` is fail-closed in
 * production (no METRICS_API_KEY ⇒ 500, and the chart leaves the key unset by
 * default), and an httpGet probe cannot read a Kubernetes Secret, so a
 * secretKeyRef-delivered key can never reach a rendered Authorization header.
 * Probing `/metrics` therefore crash-loops both the default install and the
 * secretKeyRef install. See specs/server/worker-liveness-probe.feature.
 *
 * It answers 200 whenever the event loop is turning enough to accept the
 * connection and run this handler — which is the whole question a liveness
 * probe asks, and strictly more than the old `kill -0 1` could tell us. It
 * carries no telemetry, so leaving it open exposes nothing the bearer gate on
 * `/metrics` was protecting.
 */
export const WORKER_LIVENESS_PATH = "/healthz";

/**
 * The worker metrics server's request handler, split out so the routing and
 * auth branches are testable without binding a port.
 */
export function createWorkerMetricsHandler(
  isMetricsAuthorized: (req: IncomingMessage) => boolean,
): RequestListener {
  return (req: IncomingMessage, res: ServerResponse) => {
    if (req.url === WORKER_LIVENESS_PATH) {
      res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
      return;
    }
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
  };
}

// Expose the worker process's prom-client registry over HTTP so the web
// process can scrape it at GET /workers/metrics (proxied in start.ts). In
// the in-process dev mode this is skipped — the web server serves the same
// (shared) registry at /metrics directly. The same listener serves the
// unauthenticated liveness path the chart's probes call.
async function bootMetricsServer(
  shutdownHandles: ShutdownHandles,
): Promise<void> {
  const { getWorkerMetricsPort, isMetricsAuthorized } = await import(
    "~/server/metrics"
  );
  const metricsPort = getWorkerMetricsPort();
  const metricsServer = http.createServer(
    createWorkerMetricsHandler(isMetricsAuthorized),
  );
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
    // Ingestion pulls self-drive through durable process wakes and the
    // transactional process outbox; there is no BullMQ worker to boot.
    // Topic clustering self-drives (ADR-051, retired; ground now ADR-098): the process wake worker and
    // process outbox in the event-sourcing runtime own scheduling and
    // execution; there is no BullMQ worker to boot.
    await bootStorageStatsCollection(shutdownHandles);
    await bootScenarioProcessor(shutdownHandles);
    // Langy turns self-drive: the process outbox dispatches to the Go manager,
    // which pushes signed frames to the relay. No in-process pool/executor to
    // boot; heartbeat recovery belongs to the direct liveness subscriber.
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

import { Worker } from "node:worker_threads";
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
   * standalone worker deployment, where a scraper reaches the worker directly
   * on the metrics port; off for the in-process dev mode, where the web server
   * already serves the shared registry at `/metrics`.
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

// Expose the worker process's prom-client registry over HTTP on the worker
// metrics port, behind the same bearer gate the web process uses. In a split
// deployment this port is what a scraper talks to: the chart's Prometheus
// scrape config targets the worker pod directly on it, NOT the web process's
// `/workers/metrics` proxy — that proxy dials its own loopback, so it only
// resolves when the workers share the web process (in-process dev mode).
//
// In that in-process mode this listener is skipped entirely; the web server
// serves the same shared registry at /metrics.
//
/**
 * How often the main event loop stamps its heartbeat, and how stale that
 * stamp may get before the liveness thread reports the process dead.
 *
 * The 2026-08-03 incident: a worker saturated with queue catch-up pins the
 * event loop for 60–90s of legitimate work, `/healthz` (served on that same
 * loop) misses even a 10s×6 probe budget, and Kubernetes kills exactly the
 * busiest pods — requeueing their in-flight jobs and deepening the backlog.
 * Serving liveness from a worker thread with a loop heartbeat separates the
 * two questions: "is the process alive" (thread answers instantly, always)
 * and "is the main loop moving" (heartbeat age, judged against a budget far
 * beyond any legitimate saturation but well short of "restart never comes").
 */
export const WORKER_HEARTBEAT_INTERVAL_MS = 1_000;
export const WORKER_HEARTBEAT_STALL_BUDGET_MS = 5 * 60 * 1000;
const METRICS_PROXY_TIMEOUT_MS = 10_000;

/**
 * Source for the liveness thread, evaluated via `new Worker(src, {eval:true})`
 * so it survives every bundler/runtime (no file to resolve). Plain CommonJS,
 * Node built-ins only. It owns the metrics port: `/healthz` is answered
 * in-thread from the shared heartbeat; anything else is proxied to the main
 * thread over `parentPort` (metrics bodies come from the prom-client registry,
 * which lives there) with a timeout so a stalled loop fails the scrape, never
 * the probe.
 */
export const LIVENESS_THREAD_SOURCE = `
const http = require("node:http");
const { parentPort, workerData } = require("node:worker_threads");
const heartbeat = new Float64Array(workerData.heartbeat);
const pending = new Map();
let nextId = 1;
parentPort.on("message", (msg) => {
  const entry = pending.get(msg.id);
  if (!entry) return;
  pending.delete(msg.id);
  clearTimeout(entry.timer);
  entry.res.writeHead(msg.status, msg.headers ?? {}).end(msg.body ?? "");
});
const server = http.createServer((req, res) => {
  if (req.url === workerData.livenessPath) {
    const stalledMs = Date.now() - heartbeat[0];
    if (stalledMs > workerData.stallBudgetMs) {
      res.writeHead(503, { "Content-Type": "text/plain" })
        .end("main loop stalled " + Math.round(stalledMs / 1000) + "s");
    } else {
      res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
    }
    return;
  }
  const id = nextId++;
  const timer = setTimeout(() => {
    pending.delete(id);
    res.writeHead(503).end();
  }, workerData.proxyTimeoutMs);
  pending.set(id, { res, timer });
  parentPort.postMessage({
    id,
    url: req.url,
    authorization: req.headers.authorization ?? null,
  });
});
server.listen(workerData.port, () => parentPort.postMessage({ listening: true }));
`;

// The metrics port is bound by the liveness thread (LIVENESS_THREAD_SOURCE)
// so `/healthz` keeps answering while the main loop is saturated. If the
// thread cannot start, fall back to the old in-loop server rather than boot
// with no probe target at all.
async function bootMetricsServer(
  shutdownHandles: ShutdownHandles,
): Promise<void> {
  const { getWorkerMetricsPort, isMetricsAuthorized } = await import(
    "~/server/metrics"
  );
  const metricsPort = getWorkerMetricsPort();

  const heartbeat = new Float64Array(new SharedArrayBuffer(8));
  heartbeat[0] = Date.now();
  const heartbeatTimer = setInterval(() => {
    heartbeat[0] = Date.now();
  }, WORKER_HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref();

  try {
    const thread = new Worker(LIVENESS_THREAD_SOURCE, {
      eval: true,
      workerData: {
        port: metricsPort,
        livenessPath: WORKER_LIVENESS_PATH,
        heartbeat: heartbeat.buffer,
        stallBudgetMs: WORKER_HEARTBEAT_STALL_BUDGET_MS,
        proxyTimeoutMs: METRICS_PROXY_TIMEOUT_MS,
      },
    });
    await new Promise<void>((resolve, reject) => {
      thread.once("error", reject);
      thread.on("message", (msg: { listening?: boolean; id?: number }) => {
        if (msg.listening) {
          thread.removeListener("error", reject);
          resolve();
          return;
        }
        if (msg.id === undefined) return;
        void respondToLivenessThread(
          thread,
          msg as { id: number; url: string; authorization: string | null },
          isMetricsAuthorized,
        );
      });
    });
    logger.info(
      `worker liveness thread serving port ${metricsPort} (heartbeat budget ${WORKER_HEARTBEAT_STALL_BUDGET_MS}ms)`,
    );
    shutdownHandles.push(async () => {
      clearInterval(heartbeatTimer);
      await thread.terminate();
    });
  } catch (error) {
    logger.warn(
      { error },
      "liveness thread failed to start; serving metrics/liveness on the main loop",
    );
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
      () =>
        new Promise<void>((resolve) => metricsServer.close(() => resolve())),
    );
  }
}

/**
 * Main-thread side of the liveness thread's proxy: only `/metrics` exists,
 * with the same bearer gate and fail-closed auth semantics as the in-loop
 * handler.
 */
async function respondToLivenessThread(
  thread: Worker,
  msg: { id: number; url: string; authorization: string | null },
  isMetricsAuthorized: (req: IncomingMessage) => boolean,
): Promise<void> {
  const reply = (
    status: number,
    headers?: Record<string, string>,
    body?: string,
  ) => thread.postMessage({ id: msg.id, status, headers, body });
  if (msg.url !== "/metrics") {
    reply(404);
    return;
  }
  try {
    const fakeReq = {
      headers: { authorization: msg.authorization ?? undefined },
    } as IncomingMessage;
    if (!isMetricsAuthorized(fakeReq)) {
      reply(401);
      return;
    }
  } catch (error) {
    // Fail closed when METRICS_API_KEY is unset in production.
    logger.error({ error }, "worker metrics auth misconfigured");
    reply(500);
    return;
  }
  try {
    const metrics = await register.metrics();
    reply(200, { "Content-Type": register.contentType }, metrics);
  } catch (error) {
    logger.error({ error }, "error getting worker metrics");
    reply(500);
  }
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
    // Topic clustering self-drives (ADR-051): the process wake worker and
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

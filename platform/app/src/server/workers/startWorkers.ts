import { createLogger } from "@langwatch/observability";
import { startWorkerMetricsServer } from "@langwatch/worker/liveness/server";
import type { IncomingMessage } from "node:http";
import { register } from "prom-client";
import type { App } from "~/server/app-layer/app";
import {
  AnomalyAlertHttpPort,
  type AnomalyAlertHttpResponse,
} from "@langwatch/enterprise-governance-server";
import { AppGovernanceKpisAdapter } from "@langwatch/enterprise-api/governance/governance-kpis.adapter";
import { assertRedisReady } from "~/server/app-layer/redis-readiness";
import { getWorkerMetricsPort, isMetricsAuthorized } from "~/server/metrics";
import { prisma } from "~/server/db";
import { ssrfSafeFetch } from "~/utils/ssrfProtection";

const logger = createLogger("langwatch:workers");

class AppAnomalyAlertHttpPort extends AnomalyAlertHttpPort {
  async post(input: {
    url: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  }): Promise<AnomalyAlertHttpResponse> {
    const response = await ssrfSafeFetch(input.url, {
      method: "POST",
      headers: input.headers,
      body: input.body,
      signal: input.signal,
    });
    return {
      status: response.status,
      ok: response.ok,
      statusText: response.statusText,
    };
  }
}

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
  /** The process-owned App captured by the worker runtime. */
  app: App;
}

type ShutdownHandles = Array<() => Promise<void> | void>;

// Fail fast if the database is unreachable — better to fail the boot loudly
// than to come up green and have every job fail individually.
async function verifyDatabaseReady(): Promise<void> {
  try {
    await prisma.$queryRaw`-- @tenancy: connectivity probe, touches no rows
SELECT 1`;
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
  const { startStorageStatsCollectionFromSharedClient, stopStorageStatsCollection } =
    await import("~/server/clickhouse/metrics");
  const hasStarted = startStorageStatsCollectionFromSharedClient();
  if (hasStarted) {
    shutdownHandles.push(() => stopStorageStatsCollection());
    logger.info("storage stats collection ready");
  }
}

// Scenario simulation executor: an in-process pool late-bound into the
// pool holder the simulationRunExecution process manager's execute intent
// reads. Without this the intent throws (outbox retries) and simulations
// never execute on this pod.
async function bootScenarioProcessorService(
  shutdownHandles: ShutdownHandles,
  app: App,
): Promise<void> {
  const { createAppScenarioProcessorService } = await import(
    "~/runtime/worker/app-scenario-processor.adapter"
  );
  const processor = createAppScenarioProcessorService(app);
  if (processor) {
    const handle = await processor.start();
    shutdownHandles.push(() => handle.close());
  }
  logger.info("scenario processor ready");
}

// Per-tenant enqueue-rate anomaly detector (surfaces runaway tenants on
// the Ops page).
async function bootOpsWorkers(
  shutdownHandles: ShutdownHandles,
  app: App,
): Promise<void> {
  const [opsWorker, { prisma }] = await Promise.all([
    import("~/runtime/worker/ops-workers.adapter"),
    import("~/server/db"),
  ]);
  const adapter = opsWorker.AppOpsWorkerAdapter.create({
    anomaly: {
      redis: app.redis ?? void 0,
      featureFlags: app.featureFlags,
    },
    usageStats: {
      database: prisma,
      resolveClickHouseClient: app.clickhouse.resolveOrganizationClient,
      config: opsWorker.resolveOpsWorkerConfig(process.env),
      http: globalThis.fetch,
    },
  });

  const anomalyWorker = adapter.startAnomalyWorker();
  if (anomalyWorker) {
    shutdownHandles.push(() => anomalyWorker.stop());
    logger.info("anomaly worker ready");
  }

  const usageStatsWorker = adapter.startUsageStatsWorker();
  if (usageStatsWorker) {
    shutdownHandles.push(() => usageStatsWorker.stop());
    logger.info("usage stats worker ready");
  }
}

// Governance spend-spike anomaly evaluation: a 5-minute tick that
// evaluates admin-authored spend_spike rules and persists AnomalyAlert
// rows (specs/ai-gateway/governance/anomaly-detection.feature).
async function bootSpendSpikeAnomalyWorker(
  shutdownHandles: ShutdownHandles,
  app: App,
): Promise<void> {
  const { startSpendSpikeAnomalyWorker } =
    await import("@langwatch/enterprise-worker/governance/spend-spike-anomaly.worker");
  const { prisma } = await import("~/server/db");
  const spendSpikeAnomalyWorker = startSpendSpikeAnomalyWorker({
    database: prisma,
    spend: app.clickhouse.enabled
      ? new AppGovernanceKpisAdapter(app.clickhouse.resolveClient)
      : undefined,
    http: new AppAnomalyAlertHttpPort(),
  });
  shutdownHandles.push(() => spendSpikeAnomalyWorker.stop());
  logger.info("spend spike anomaly worker ready");
}

// Reconciles brokered realtime voice sessions whose post-call webhook never
// arrived, so the webhook is an optimisation rather than something a
// customer must configure before voice spend can be billed at all
// (specs/ai-gateway/realtime-sessions.feature).
async function bootRealtimeSessionPoller(
  shutdownHandles: ShutdownHandles,
): Promise<void> {
  const [pollerModule, { prisma }, credentialService, sessionService, gatewayServer] =
    await Promise.all([
      import("~/runtime/worker/gateway-realtime-session-reconciliation.adapter"),
      import("~/server/db"),
      import("~/server/gateway/elevenLabsCredential.service"),
      import("~/server/gateway/realtimeSession.service"),
      import("@langwatch/gateway-server/realtime-session-reconciliation"),
    ]);
  const poller = pollerModule.startRealtimeSessionPoller({
    database: pollerModule.PrismaRealtimeSessionPollerDatabase.create({
      database: prisma,
    }),
    sessions: {
      expireStaleSessions: sessionService.expireStaleRealtimeSessions,
      releaseRealtimeSession: sessionService.releaseRealtimeSession,
      closeAndConfirmRealtimeSession: sessionService.closeAndConfirmRealtimeSession,
    },
    credentials: { getApiCredential: credentialService.getElevenLabsApiCredential },
    logger: createLogger("langwatch:workers:realtimeSessionPoller"),
    config: gatewayServer.realtimeSessionReconciliationConfig,
    clock: { now: () => new Date() },
  });
  shutdownHandles.push(() => poller.stop());
  logger.info("realtime voice session poller ready");
}

// The worker's one HTTP listener: the Prometheus metrics port, which also
// answers the kubelet's unauthenticated `/healthz`. The server itself lives in
// `@langwatch/worker`; this supplies the three things it deliberately does not
// import — the port, the bearer gate, and a read of THIS process's prom-client
// registry.
//
// `register` is a process-global singleton, so it is read here and handed over
// rather than imported there: two resolved copies of prom-client would serve an
// empty registry instead of failing, which reads as "the worker has no metrics"
// rather than as a bug.
async function bootMetricsServer(shutdownHandles: ShutdownHandles): Promise<void> {
  const metricsServer = await startWorkerMetricsServer({
    port: getWorkerMetricsPort(),
    // The gate reads only `headers.authorization`; the port is narrowed to
    // that, and this is where the narrow shape meets the real IncomingMessage.
    isAuthorized: (request) => isMetricsAuthorized(request as IncomingMessage),
    readMetrics: async () => ({
      body: await register.metrics(),
      contentType: register.contentType,
    }),
    logger,
  });
  shutdownHandles.push(() => metricsServer.close());
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
 * the returned `shutdown()` on teardown. The explicit worker executable also
 * passes that same App through `options.app` so late-bound worker capabilities
 * do not need to recover it from the process singleton.
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
export async function startWorkers(options: StartWorkersOptions): Promise<WorkerHandle> {
  const shouldStartMetricsServer = options.shouldStartMetricsServer ?? true;

  // Resources that hold OS-level handles — child processes, sockets, timers,
  // Redis subscribers — and must be released on shutdown. Populated as each
  // worker boots below.
  const shutdownHandles: ShutdownHandles = [];
  const closeRegisteredWorkers = async (): Promise<void> => {
    // Reverse order: later stages may depend on earlier ones (e.g. the
    // scenario processor depends on the pool it registered into), so tear
    // down newest-first.
    await Promise.allSettled([...shutdownHandles].reverse().map((close) => close()));
  };

  await assertRedisReady({ app: options.app });
  await verifyDatabaseReady();

  try {
    // Ingestion pulls self-drive through durable process wakes and the
    // transactional process outbox; there is no separate queue worker to boot.
    // Topic clustering self-drives (ADR-051): the process wake worker and
    // process outbox in the event-sourcing runtime own scheduling and
    // execution; there is no separate queue worker to boot.
    await bootStorageStatsCollection(shutdownHandles);
    await bootScenarioProcessorService(shutdownHandles, options.app);
    // Langy turns self-drive: the process outbox dispatches to the Go manager,
    // which pushes signed frames to the relay. No in-process pool/executor to
    // boot; heartbeat recovery belongs to the direct liveness subscriber.
    await bootOpsWorkers(shutdownHandles, options.app);
    await bootSpendSpikeAnomalyWorker(shutdownHandles, options.app);
    await bootRealtimeSessionPoller(shutdownHandles);
    // One-time in-place data migrations (ADR-092 stage B and successors) are
    // NOT booted here: they are a worker-only background loop like the
    // scheduler, so the app layer starts them and the App's graceful
    // closeables stop them (see presets.ts).
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

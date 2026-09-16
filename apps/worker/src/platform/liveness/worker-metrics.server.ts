import http, { type IncomingMessage, type RequestListener, type ServerResponse } from "node:http";
import { Worker } from "node:worker_threads";
import type { Logger } from "@langwatch/observability";
import { WORKER_HEARTBEAT_STALL_BUDGET_MS, WORKER_LIVENESS_PATH } from "./worker.liveness.ts";
import { nowInstant } from "@langwatch/time";

/**
 * Worker's single HTTP listener: Prometheus metrics port + kubelet liveness path. Registry comes
 * through `readMetrics` port (not imported here) to avoid duplicate prom-client singletons.
 */

/** The auth input, shaped like the only part of a request the gate reads. */
export interface WorkerMetricsRequest {
  readonly headers: { readonly authorization?: string | undefined };
}

/** One rendered scrape, exactly as the host's registry produced it. */
export interface WorkerMetricsSnapshot {
  readonly body: string;
  readonly contentType: string;
}

export type WorkerMetricsLogger = Pick<Logger, "info" | "warn" | "error">;

export interface WorkerMetricsMembers {
  /**
   * The host's bearer gate. May THROW to mean "fail closed" (production with
   * no metrics API key configured), which is answered 500, never 200.
   */
  isAuthorized: (request: WorkerMetricsRequest) => boolean;
  /** Renders the host process's metrics registry. */
  readMetrics: () => Promise<WorkerMetricsSnapshot>;
  logger?: WorkerMetricsLogger;
}

export interface StartWorkerMetricsServerOptions extends WorkerMetricsMembers {
  /** The port the liveness thread binds — the port the kubelet probes. */
  port: number;
}

export interface WorkerMetricsServerHandle {
  /** Stops the heartbeat and releases the listener (thread or in-loop server). */
  close: () => Promise<void>;
}

/**
 * The single bearer gate + registry read for the worker's `/metrics`,
 * transport-agnostic so the in-loop HTTP handler and the liveness thread's
 * proxy share ONE copy of the security decision (two copies drift).
 */
async function evaluateMetricsRequest({
  url,
  request,
  isAuthorized,
  readMetrics,
  logger,
}: {
  url: string | undefined;
  request: WorkerMetricsRequest;
} & WorkerMetricsMembers): Promise<{
  status: number;
  headers?: Record<string, string>;
  body?: string;
}> {
  if (url !== "/metrics") return { status: 404 };
  try {
    if (!isAuthorized(request)) return { status: 401 };
  } catch (error) {
    // Fail closed when the metrics API key is unset in production.
    logger?.error({ error }, "worker metrics auth misconfigured");
    return { status: 500 };
  }
  try {
    const { body, contentType } = await readMetrics();
    return {
      status: 200,
      headers: { "Content-Type": contentType },
      body,
    };
  } catch (error) {
    logger?.error({ error }, "error getting worker metrics");
    return { status: 500 };
  }
}

/**
 * The worker metrics server's request handler, split out so routing and auth
 * are testable without binding a port. Used directly only on the fallback
 * path; the normal path serves the same decisions through the thread proxy.
 */
export function createWorkerMetricsHandler(ports: WorkerMetricsMembers): RequestListener {
  return (req: IncomingMessage, res: ServerResponse) => {
    if (req.url === WORKER_LIVENESS_PATH) {
      res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
      return;
    }
    void evaluateMetricsRequest({
      url: req.url,
      request: req,
      ...ports,
    }).then(({ status, headers, body }) => {
      res.writeHead(status, headers ?? {}).end(body ?? "");
    });
  };
}

/**
 * Heartbeat interval: liveness served from worker thread separates "is process alive" (always
 * yes) from "is main loop moving" (judged by heartbeat age).
 */
export const WORKER_HEARTBEAT_INTERVAL_MS = 1_000;
const METRICS_PROXY_TIMEOUT_MS = 10_000;

/**
 * Liveness thread source (string-eval'd): serves /healthz from heartbeat, proxies other
 * requests. Cannot import liveness predicate (no module graph in eval'd thread).
 */
export const LIVENESS_THREAD_SOURCE = `
const http = require("node:http");
const { parentPort, workerData } = require("node:worker_threads");
// BigInt64 + Atomics: plain cross-thread Float64Array access has no atomicity
// guarantee (a torn read yields a garbage timestamp); Atomics only supports
// integer typed arrays, and epoch millis fit BigInt64 exactly.
const heartbeat = new BigInt64Array(workerData.heartbeat);
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
    const stalledMs = Date.now() - Number(Atomics.load(heartbeat, 0));
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
server.listen(workerData.port, () => parentPort.postMessage({ isListening: true }));
`;

/**
 * Exposes host metrics registry over HTTP + kubelet liveness probe. Port bound by liveness
 * thread (not in-loop) for resilience; falls back to in-loop if thread fails.
 */
export async function startWorkerMetricsServer(
  options: StartWorkerMetricsServerOptions,
): Promise<WorkerMetricsServerHandle> {
  const { port, logger, ...ports } = options;

  // BigInt64 + Atomics — see the note in LIVENESS_THREAD_SOURCE.
  const heartbeat = new BigInt64Array(new SharedArrayBuffer(8));
  Atomics.store(heartbeat, 0, BigInt(nowInstant().epochMilliseconds));
  const heartbeatTimer = setInterval(() => {
    Atomics.store(heartbeat, 0, BigInt(nowInstant().epochMilliseconds));
  }, WORKER_HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref();

  let thread: Worker | undefined;
  try {
    thread = new Worker(LIVENESS_THREAD_SOURCE, {
      eval: true,
      workerData: {
        port,
        livenessPath: WORKER_LIVENESS_PATH,
        heartbeat: heartbeat.buffer,
        stallBudgetMs: WORKER_HEARTBEAT_STALL_BUDGET_MS,
        proxyTimeoutMs: METRICS_PROXY_TIMEOUT_MS,
      },
    });
    await wireLivenessThread({ thread, logger, ...ports });
    const startedThread = thread;
    logger?.info(
      `worker liveness thread serving port ${port} (heartbeat budget ${WORKER_HEARTBEAT_STALL_BUDGET_MS}ms)`,
    );
    return {
      close: async () => {
        clearInterval(heartbeatTimer);
        // terminate() itself emits a non-zero "exit"; that's a graceful
        // shutdown, not the unexpected-death case the listener reports.
        startedThread.removeAllListeners("exit");
        await startedThread.terminate();
      },
    };
  } catch (error) {
    // The fallback server has no heartbeat consumer, so stop stamping it —
    // and reap the thread if it was spawned but failed before listening.
    clearInterval(heartbeatTimer);
    await thread?.terminate().catch(() => undefined);
    logger?.warn(
      { error },
      "liveness thread failed to start; serving metrics/liveness on the main loop",
    );
    return startFallbackMetricsServer({ port, logger, ...ports });
  }
}

/**
 * Wires the liveness thread's lifecycle: resolves once listening, routes its
 * proxy messages, and installs error/exit listeners — an unhandled Worker
 * "error" would otherwise re-throw on the main thread and kill the process.
 */
async function wireLivenessThread({
  thread,
  ...ports
}: { thread: Worker } & WorkerMetricsMembers): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    // Reject on early exit too: a thread that dies before listening without
    // emitting "error" would otherwise leave this promise pending forever
    // and the fallback server would never start.
    const rejectOnEarlyExit = (code: number) =>
      reject(new Error(`liveness thread exited before listening (code ${code})`));
    thread.once("error", reject);
    thread.once("exit", rejectOnEarlyExit);
    thread.on("message", (msg: { isListening?: boolean; id?: number }) => {
      if (msg.isListening) {
        thread.removeListener("error", reject);
        thread.removeListener("exit", rejectOnEarlyExit);
        resolve();
        return;
      }
      if (msg.id === undefined) return;
      void respondToLivenessThread({
        thread,
        msg: msg as { id: number; url: string; authorization: string | null },
        ...ports,
      });
    });
  });
  thread.on("error", (error) => {
    ports.logger?.error({ error }, "worker liveness thread errored");
  });
  thread.on("exit", (code) => {
    if (code !== 0) {
      ports.logger?.error({ code }, "worker liveness thread exited unexpectedly");
    }
  });
}

/** The pre-thread in-loop server, kept as the fallback when the thread cannot start. */
async function startFallbackMetricsServer({
  port,
  ...ports
}: StartWorkerMetricsServerOptions): Promise<WorkerMetricsServerHandle> {
  const metricsServer = http.createServer(createWorkerMetricsHandler(ports));
  await new Promise<void>((resolve, reject) => {
    metricsServer.once("error", reject);
    metricsServer.listen(port, () => {
      metricsServer.removeListener("error", reject);
      ports.logger?.info(`worker metrics server listening on port ${port}`);
      resolve();
    });
  });
  return {
    close: () => new Promise<void>((resolve) => metricsServer.close(() => resolve())),
  };
}

/**
 * Main-thread side of the liveness thread's proxy: only `/metrics` exists,
 * with the same bearer gate and fail-closed auth semantics as the in-loop
 * handler.
 */
async function respondToLivenessThread({
  thread,
  msg,
  ...ports
}: {
  thread: Worker;
  msg: { id: number; url: string; authorization: string | null };
} & WorkerMetricsMembers): Promise<void> {
  const { status, headers, body } = await evaluateMetricsRequest({
    url: msg.url,
    request: { headers: { authorization: msg.authorization ?? undefined } },
    ...ports,
  });
  thread.postMessage({ id: msg.id, status, headers, body });
}

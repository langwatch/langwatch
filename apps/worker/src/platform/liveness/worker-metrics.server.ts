import http, {
  type IncomingMessage,
  type RequestListener,
  type ServerResponse,
} from "node:http";
import { Worker } from "node:worker_threads";
import type { Logger } from "@langwatch/observability";
import {
  WORKER_HEARTBEAT_STALL_BUDGET_MS,
  WORKER_LIVENESS_PATH,
} from "./worker.liveness";

/**
 * The worker process's single HTTP listener: the Prometheus metrics port, which
 * also answers the kubelet's unauthenticated liveness path.
 *
 * Everything the endpoint needs from the process that hosts it arrives as a
 * port. In particular the prom-client registry is NOT imported here: `register`
 * is a process-global singleton, and two packages resolving two copies of
 * prom-client would serve an empty registry rather than fail — a silent,
 * total loss of worker metrics. The host reads its own registry and hands the
 * rendered text over through `readMetrics`.
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

export interface WorkerMetricsPorts {
  /**
   * The host's bearer gate. May THROW to mean "fail closed" (production with
   * no metrics API key configured), which is answered 500, never 200.
   */
  isAuthorized: (request: WorkerMetricsRequest) => boolean;
  /** Renders the host process's metrics registry. */
  readMetrics: () => Promise<WorkerMetricsSnapshot>;
  logger?: WorkerMetricsLogger;
}

export interface StartWorkerMetricsServerOptions extends WorkerMetricsPorts {
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
} & WorkerMetricsPorts): Promise<{
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
 * The worker metrics server's request handler, split out so the routing and
 * auth branches are testable without binding a port. Used directly only on
 * the fallback path (liveness thread failed to start); the normal path serves
 * the same decisions through the thread proxy.
 */
export function createWorkerMetricsHandler(ports: WorkerMetricsPorts): RequestListener {
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
 * How often the main event loop stamps its heartbeat. The staleness budget it
 * is judged against lives with the rest of the liveness policy, in
 * `worker.liveness.ts`.
 *
 * A worker saturated with queue catch-up can pin the event loop for over a
 * minute of legitimate work; `/healthz` served on that same loop then misses
 * any realistic kubelet probe budget, and Kubernetes kills exactly the
 * busiest pods — requeueing their in-flight jobs and deepening the backlog
 * that caused the saturation. Serving liveness from a worker thread with a
 * loop heartbeat separates the two questions: "is the process alive" (thread
 * answers instantly, always) and "is the main loop moving" (heartbeat age,
 * judged against a budget far beyond any legitimate saturation but well
 * short of "restart never comes").
 */
export const WORKER_HEARTBEAT_INTERVAL_MS = 1_000;
const METRICS_PROXY_TIMEOUT_MS = 10_000;

/**
 * Source for the liveness thread, evaluated via `new Worker(src, {eval:true})`
 * so it survives every bundler/runtime (no file to resolve). Plain CommonJS,
 * Node built-ins only. It owns the metrics port: `/healthz` is answered
 * in-thread from the shared heartbeat; anything else is proxied to the main
 * thread over `parentPort` (metrics bodies come from the prom-client registry,
 * which lives there) with a timeout so a stalled loop fails the scrape, never
 * the probe.
 *
 * The heartbeat comparison below is the worker's ONE liveness predicate. It
 * cannot import one, because this module is a string evaluated in a thread
 * with no module graph — which is why there is no second copy in TypeScript
 * for it to drift from.
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
 * Exposes the host process's metrics registry over HTTP on the worker metrics
 * port, behind the host's bearer gate, and answers the kubelet's liveness
 * probe on the same port.
 *
 * In a split deployment this port is what a scraper talks to: the chart's
 * Prometheus scrape config targets the worker pod directly on it, NOT the web
 * process's `/workers/metrics` proxy — that proxy dials its own loopback, so it
 * only resolves when the workers share the web process (in-process dev mode).
 * In that in-process mode this server is not started at all; the web server
 * serves the same shared registry at `/metrics`.
 *
 * The port is bound by the liveness thread (LIVENESS_THREAD_SOURCE) so
 * `/healthz` keeps answering while the main loop is saturated. If the thread
 * cannot start, fall back to the old in-loop server rather than boot with no
 * probe target at all.
 */
export async function startWorkerMetricsServer(
  options: StartWorkerMetricsServerOptions,
): Promise<WorkerMetricsServerHandle> {
  const { port, logger, ...ports } = options;

  // BigInt64 + Atomics — see the note in LIVENESS_THREAD_SOURCE.
  const heartbeat = new BigInt64Array(new SharedArrayBuffer(8));
  Atomics.store(heartbeat, 0, BigInt(Date.now()));
  const heartbeatTimer = setInterval(() => {
    Atomics.store(heartbeat, 0, BigInt(Date.now()));
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
 * Wires the liveness thread's lifecycle: resolves once it is listening,
 * routes its proxy messages, and installs the post-startup error/exit
 * listeners (an unhandled Worker "error" would re-throw on the main thread
 * and kill the process; a dead thread instead stops answering the port,
 * probes fail, and the pod restarts through the normal Kubernetes path).
 */
async function wireLivenessThread({
  thread,
  ...ports
}: { thread: Worker } & WorkerMetricsPorts): Promise<void> {
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
} & WorkerMetricsPorts): Promise<void> {
  const { status, headers, body } = await evaluateMetricsRequest({
    url: msg.url,
    request: { headers: { authorization: msg.authorization ?? undefined } },
    ...ports,
  });
  thread.postMessage({ id: msg.id, status, headers, body });
}

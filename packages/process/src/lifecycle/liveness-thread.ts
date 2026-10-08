import type { AddressInfo } from "node:net";
import { Worker } from "node:worker_threads";

/** The kubelet's path; answered in the thread from the heartbeat, never proxied. */
export const LIVENESS_PATH = "/healthz";
/** Answered in the thread once the main thread latched ready; until then the main thread says. */
export const READINESS_PATH = "/readyz";

/**
 * A saturated worker can pin its loop for over a minute of legitimate work, so the probe judges
 * the loop by how long its heartbeat has not moved, against a budget far beyond that.
 * Values are main's (platform/app/src/server/workers/startWorkers.ts).
 */
export const HEARTBEAT_INTERVAL_MS = 1_000;
export const HEARTBEAT_STALL_BUDGET_MS = 5 * 60 * 1000;
/**
 * How long the main loop's heartbeat may stand still while a proxied request waits on it. A
 * request on a turning loop waits as long as its handler takes (a long poll, a slow export).
 */
export const MAIN_THREAD_PROXY_TIMEOUT_MS = 10_000;

const BIND_HANDOVER_MS = 10_000;
/** How long a caller held off by an upgrade waits before trying again; the page refreshes on it. */
export const UPGRADE_RETRY_AFTER_SECONDS = 10;

/** All the unauthenticated holding page may say (Q-U4): the phase and outstanding step ids. */
export type UpgradeHolding = Readonly<{ phase: string; outstandingStepIds: readonly string[] }>;

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** The page browsers see while an upgrade holds the door. Spec: upgrade-holding-page.feature */
export function renderUpgradeHoldingPage({ phase, outstandingStepIds }: UpgradeHolding): string {
  const steps = outstandingStepIds.map((id) => `<li><code>${escapeHtml(id)}</code></li>`).join("");
  return [
    "<!doctype html>",
    `<html lang="en"><head><meta charset="utf-8"><meta http-equiv="refresh" content="${UPGRADE_RETRY_AFTER_SECONDS}">`,
    "<title>LangWatch is upgrading</title>",
    "<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;color:#1a1a1a}</style>",
    "</head><body><h1>LangWatch is upgrading</h1>",
    `<p>Phase: <strong>${escapeHtml(phase)}</strong></p>`,
    steps === "" ? "" : `<p>Outstanding steps:</p><ul>${steps}</ul>`,
    "<p>This page refreshes on its own.</p></body></html>",
  ].join("");
}

/**
 * Plain CommonJS, Node built-ins only, evaluated with `eval: true` so no file has to resolve
 * under any bundler. It owns the public port: the liveness path from the heartbeat, anything
 * else (upgrades included) proxied to the main thread's loopback listener.
 */
const LIVENESS_THREAD_SOURCE = `
const http = require("node:http");
const net = require("node:net");
const { parentPort, workerData } = require("node:worker_threads");
const heartbeat = new BigInt64Array(workerData.heartbeat);
const readiness = new Int32Array(workerData.readiness);
let lastBeat = Atomics.load(heartbeat, 0);
let lastBeatSeenAt = Date.now();
const stalledMs = () => {
  const beat = Atomics.load(heartbeat, 0);
  if (beat !== lastBeat) {
    lastBeat = beat;
    lastBeatSeenAt = Date.now();
  }
  return Date.now() - lastBeatSeenAt;
};
const target = { host: "127.0.0.1", port: workerData.proxyPort };
let holdingPage = null;
const answerHolding = (req, res) => {
  const html = String(req.headers.accept || "").includes("text/html");
  req.resume();
  res.writeHead(503, {
    "Content-Type": html ? "text/html; charset=utf-8" : "text/plain",
    "Retry-After": String(workerData.retryAfterSeconds),
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
  }).end(html ? holdingPage : "LangWatch is upgrading");
};
const unavailable = (res, body) => {
  if (res.destroyed || res.writableEnded) return;
  if (res.headersSent) return res.destroy();
  res.writeHead(503, { "Content-Type": "text/plain" }).end(body);
};
const server = http.createServer((req, res) => {
  if (req.url === workerData.livenessPath) {
    const stalled = stalledMs();
    if (stalled > workerData.stallBudgetMs) {
      unavailable(res, "main loop stalled " + Math.round(stalled / 1000) + "s");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
    return;
  }
  if (req.url === workerData.readinessPath && Atomics.load(readiness, 0) === 1) {
    res.writeHead(200, { "Content-Type": "text/plain" }).end("ready");
    return;
  }
  if (holdingPage !== null) {
    answerHolding(req, res);
    return;
  }
  const upstream = http.request({ ...target, method: req.method, path: req.url, headers: req.headers, agent: false });
  const timer = setInterval(() => {
    if (stalledMs() < workerData.proxyTimeoutMs) return;
    clearInterval(timer);
    upstream.destroy();
    unavailable(res, "main thread did not answer");
  }, Math.min(1000, Math.max(10, workerData.proxyTimeoutMs / 4)));
  res.on("close", () => {
    clearInterval(timer);
    if (!res.writableEnded) upstream.destroy();
  });
  upstream.on("response", (reply) => {
    clearInterval(timer);
    res.writeHead(reply.statusCode ?? 502, reply.headers);
    reply.pipe(res);
  });
  upstream.on("error", () => {
    clearInterval(timer);
    unavailable(res, "main thread did not answer");
  });
  req.pipe(upstream);
});
server.on("upgrade", (req, socket, head) => {
  if (holdingPage !== null) {
    socket.end("HTTP/1.1 503 Service Unavailable\\r\\nRetry-After: " + workerData.retryAfterSeconds + "\\r\\nConnection: close\\r\\nContent-Length: 0\\r\\n\\r\\n");
    return;
  }
  const upstream = net.connect(target, () => {
    let lines = req.method + " " + req.url + " HTTP/" + req.httpVersion + "\\r\\n";
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      lines += req.rawHeaders[i] + ": " + req.rawHeaders[i + 1] + "\\r\\n";
    }
    upstream.write(lines + "\\r\\n");
    if (head.length > 0) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
});
const deadline = Date.now() + workerData.handoverMs;
const bind = () => server.listen(workerData.port);
server.on("listening", () => parentPort.postMessage({ type: "listening", address: server.address() }));
server.on("error", (error) => {
  if (error.code === "EADDRINUSE" && Date.now() < deadline) {
    setTimeout(bind, 250);
    return;
  }
  parentPort.postMessage({ type: "failed", code: error.code, message: error.message });
});
parentPort.on("message", (message) => {
  if (message.type === "hold") {
    holdingPage = message.page;
    parentPort.postMessage({ type: "held" });
    return;
  }
  if (message.type !== "close") return;
  server.close(() => parentPort.postMessage({ type: "closed" }));
  server.closeIdleConnections();
  setTimeout(() => {
    parentPort.postMessage({ type: "stragglers" });
    server.closeAllConnections();
  }, message.graceMs).unref();
});
bind();
`;

/**
 * The main loop's heartbeat: a counter in shared memory it bumps while it turns. The thread
 * dates each change on its own clock, so no time crosses threads; Atomics keeps reads whole.
 */
export type Heartbeat = Readonly<{
  buffer: SharedArrayBuffer;
  stop: () => void;
}>;

export function startHeartbeat({ intervalMs }: { intervalMs: number }): Heartbeat {
  const beats = new BigInt64Array(new SharedArrayBuffer(8));
  const timer = setInterval(() => Atomics.add(beats, 0, 1n), intervalMs);
  timer.unref();
  return { buffer: beats.buffer as SharedArrayBuffer, stop: () => clearInterval(timer) };
}

type ThreadMessage =
  | { type: "listening"; address: AddressInfo }
  | { type: "failed"; code?: string; message: string }
  | { type: "closed" }
  | { type: "held" }
  | { type: "stragglers" };

export type LivenessLogger = Readonly<{
  info: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
}>;

/** The thread that owns a process's public door while its main loop does the work. */
export type LivenessThread = Readonly<{
  address: AddressInfo;
  /** Stops accepting, gives in-flight requests `graceMs`, destroys the rest, ends the thread. */
  close: (options: { graceMs: number }) => Promise<void>;
  /** Serves the holding page in place of the main thread until called with `undefined`. */
  hold: (holding: UpgradeHolding | undefined) => Promise<void>;
}>;

/** Starts the thread and resolves once it is listening; rejects when it cannot bind or start. */
export async function startLivenessThread({
  port,
  heartbeat,
  readiness,
  proxyPort,
  logger,
  stallBudgetMs = HEARTBEAT_STALL_BUDGET_MS,
  proxyTimeoutMs = MAIN_THREAD_PROXY_TIMEOUT_MS,
}: {
  port: number;
  heartbeat: SharedArrayBuffer;
  /** One Int32 the main thread sets to 1 once ready and back to 0 when it drains. */
  readiness?: SharedArrayBuffer;
  /** The main thread's loopback listener every non-liveness request is proxied to. */
  proxyPort: number;
  logger: LivenessLogger;
  stallBudgetMs?: number;
  proxyTimeoutMs?: number;
}): Promise<LivenessThread> {
  const thread = new Worker(LIVENESS_THREAD_SOURCE, {
    eval: true,
    workerData: {
      port,
      heartbeat,
      // Absent, the thread never answers readiness itself: every probe reaches the main thread.
      readiness: readiness ?? new SharedArrayBuffer(4),
      proxyPort,
      stallBudgetMs,
      proxyTimeoutMs,
      livenessPath: LIVENESS_PATH,
      readinessPath: READINESS_PATH,
      handoverMs: BIND_HANDOVER_MS,
      retryAfterSeconds: UPGRADE_RETRY_AFTER_SECONDS,
    },
  });
  // The main loop keeps its own loopback listener, which is what holds the process open.
  thread.unref();
  let address: AddressInfo;
  try {
    address = await listeningAddress(thread);
  } catch (error) {
    await thread.terminate();
    throw error;
  }
  const exited = new Promise<void>((resolve) => thread.once("exit", () => resolve()));
  thread.on("error", (error) => logger.error({ error }, "liveness thread failed"));
  return {
    address,
    hold: async (holding) => {
      const held = new Promise<void>((resolve) => {
        const onMessage = (message: ThreadMessage): void => {
          if (message.type !== "held") return;
          thread.off("message", onMessage);
          resolve();
        };
        thread.on("message", onMessage);
      });
      const page = holding === undefined ? null : renderUpgradeHoldingPage(holding);
      thread.postMessage({ type: "hold", page });
      await Promise.race([held, exited]);
    },
    close: async ({ graceMs }) => {
      const closed = new Promise<void>((resolve) => {
        thread.on("message", (message: ThreadMessage) => {
          if (message.type === "closed") resolve();
          if (message.type === "stragglers") {
            logger.info(
              { graceMs },
              "connections outlived the drain grace, destroying the stragglers",
            );
          }
        });
      });
      thread.postMessage({ type: "close", graceMs });
      await Promise.race([closed, exited]);
      await thread.terminate();
    },
  };
}

function listeningAddress(thread: Worker): Promise<AddressInfo> {
  return new Promise((resolve, reject) => {
    const onExit = (code: number): void =>
      reject(new Error(`liveness thread exited before listening (code ${code})`));
    const onMessage = (message: ThreadMessage): void => {
      if (message.type === "listening") {
        settle();
        resolve(message.address);
      }
      if (message.type === "failed") {
        settle();
        reject(Object.assign(new Error(message.message), { code: message.code }));
      }
    };
    const settle = (): void => {
      thread.off("error", reject);
      thread.off("exit", onExit);
      thread.off("message", onMessage);
    };
    thread.once("error", reject);
    thread.once("exit", onExit);
    thread.on("message", onMessage);
  });
}

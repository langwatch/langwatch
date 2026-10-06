import type { AddressInfo } from "node:net";
import { Worker } from "node:worker_threads";

/** The kubelet's path; answered in the thread from the heartbeat, never proxied. */
export const LIVENESS_PATH = "/healthz";

/**
 * A saturated worker can pin its loop for over a minute of legitimate work, so the probe judges
 * the loop by how long its heartbeat has not moved, against a budget far beyond that.
 * Values are main's (platform/app/src/server/workers/startWorkers.ts).
 */
export const HEARTBEAT_INTERVAL_MS = 1_000;
export const HEARTBEAT_STALL_BUDGET_MS = 5 * 60 * 1000;
/** How long a proxied request waits on the main thread before a stalled loop fails the scrape. */
export const MAIN_THREAD_PROXY_TIMEOUT_MS = 10_000;

const BIND_HANDOVER_MS = 10_000;

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
const unavailable = (res, body) => {
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
  const upstream = http.request({ ...target, method: req.method, path: req.url, headers: req.headers, agent: false });
  const timer = setTimeout(() => {
    upstream.destroy();
    unavailable(res, "main thread did not answer");
  }, workerData.proxyTimeoutMs);
  upstream.on("response", (reply) => {
    clearTimeout(timer);
    res.writeHead(reply.statusCode ?? 502, reply.headers);
    reply.pipe(res);
  });
  upstream.on("error", () => {
    clearTimeout(timer);
    unavailable(res, "main thread did not answer");
  });
  req.pipe(upstream);
});
server.on("upgrade", (req, socket, head) => {
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
}>;

/** Starts the thread and resolves once it is listening; rejects when it cannot bind or start. */
export async function startLivenessThread({
  port,
  heartbeat,
  proxyPort,
  logger,
  stallBudgetMs = HEARTBEAT_STALL_BUDGET_MS,
  proxyTimeoutMs = MAIN_THREAD_PROXY_TIMEOUT_MS,
}: {
  port: number;
  heartbeat: SharedArrayBuffer;
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
      proxyPort,
      stallBudgetMs,
      proxyTimeoutMs,
      livenessPath: LIVENESS_PATH,
      handoverMs: BIND_HANDOVER_MS,
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

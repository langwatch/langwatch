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

/** The failure console's forms (UPGRADE-CONSOLE, 2026-10-09); answered only while it shows. */
export const UPGRADE_CONSOLE_PATH = "/_upgrade/console";
export const UPGRADE_RETRY_PATH = "/_upgrade/retry";
/** D3: the token is swapped once for this cookie, void when the hold lifts or the process exits. */
export const UPGRADE_CONSOLE_COOKIE = "langwatch_upgrade_console";
/** D2: a console token opens the console once, within this long of being printed. */
export const UPGRADE_CONSOLE_TOKEN_TTL_MS = 30 * 60_000;
/** D4: wrong tokens a process takes in a minute before every submission answers 429. */
export const UPGRADE_CONSOLE_WRONG_TOKENS_PER_MINUTE = 5;

/** All the unauthenticated holding page may say (Q-U4): the phase and outstanding step ids. */
export type UpgradeHolding = Readonly<{ phase: string; outstandingStepIds: readonly string[] }>;

/** A failed upgrade run, shown only to a console session. D1: the thread gets the token's hash. */
export type UpgradeConsole = Readonly<{
  failedSteps: readonly Readonly<{ id: string; error: string | null }>[];
  logTail: readonly string[];
  tokenSha256: string;
  /** The thread starts the token's clock on its own, so no time crosses threads. */
  tokenTtlMs: number;
}>;

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

const consolePage = (body: readonly string[]): string =>
  [
    "<!doctype html>",
    `<html lang="en"><head><meta charset="utf-8"><title>LangWatch's upgrade needs an operator</title>`,
    "<style>body{font-family:system-ui,sans-serif;max-width:48rem;margin:10vh auto;padding:0 1rem;color:#1a1a1a}pre{overflow:auto;background:#f4f4f4;padding:.5rem}</style>",
    "</head><body>",
    ...body,
    "</body></html>",
  ].join("");

/** A failed upgrade's page to anyone without a console session: no step, error, host or version. */
export function renderUpgradeConsoleLogin({ refused }: { refused: boolean }): string {
  return consolePage([
    "<h1>LangWatch's upgrade needs an operator</h1>",
    refused
      ? `<p><strong>That token was not accepted.</strong> A token opens the console once, within ${UPGRADE_CONSOLE_TOKEN_TTL_MS / 60_000} minutes; restart the api to print a new one.</p>`
      : "",
    "<p>Enter the console token this api printed in its log when the upgrade failed.</p>",
    `<form method="post" action="${UPGRADE_CONSOLE_PATH}"><input type="password" name="token" autocomplete="off" required aria-label="Console token"> <button type="submit">Open the console</button></form>`,
  ]);
}

/** The console a session sees: the failed steps, the run's last lines, Retry. */
export function renderUpgradeConsole({
  failedSteps,
  logTail,
}: Pick<UpgradeConsole, "failedSteps" | "logTail">): string {
  const steps = failedSteps
    .map(({ id, error }) => `<li><code>${escapeHtml(id)}</code>: ${escapeHtml(error ?? "")}</li>`)
    .join("");
  return consolePage([
    "<h1>The upgrade failed</h1>",
    steps === "" ? "" : `<p>Failed steps:</p><ul>${steps}</ul>`,
    `<p>The last ${logTail.length} lines of the run's log:</p><pre>${escapeHtml(logTail.join("\n"))}</pre>`,
    `<form method="post" action="${UPGRADE_RETRY_PATH}"><button type="submit">Retry</button></form>`,
  ]);
}

/**
 * Plain CommonJS, Node built-ins only, evaluated with `eval: true` so no file has to resolve
 * under any bundler. It owns the public port: the liveness path from the heartbeat, anything
 * else (upgrades included) proxied to the main thread's loopback listener.
 */
const LIVENESS_THREAD_SOURCE = `
const crypto = require("node:crypto");
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
let consoleHold = null;
const sessions = [];
let wrongTokensAt = [];
const sha256 = (value) => crypto.createHash("sha256").update(value).digest();
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
const answerConsole = (res, status, page, headers) => {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
    ...headers,
  }).end(page);
};
const hasSession = (req) => {
  const prefix = workerData.consoleCookie + "=";
  const pair = String(req.headers.cookie || "").split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix));
  if (pair === undefined) return false;
  const hashed = sha256(pair.slice(prefix.length));
  return sessions.some((session) => crypto.timingSafeEqual(session, hashed));
};
const openConsole = (req, res, token) => {
  const held = consoleHold;
  if (held === null) return answerHolding(req, res);
  const now = Date.now();
  wrongTokensAt = wrongTokensAt.filter((at) => now - at < 60000);
  if (wrongTokensAt.length >= workerData.wrongTokensPerMinute) {
    res.writeHead(429, { "Content-Type": "text/plain", "Retry-After": "60", "Cache-Control": "no-store" }).end("Too many wrong console tokens; wait a minute");
    return;
  }
  const matches = crypto.timingSafeEqual(sha256(token), held.tokenSha256);
  if (!matches || held.used || now >= held.expiresAt) {
    wrongTokensAt.push(now);
    answerConsole(res, 403, held.refusedPage);
    return;
  }
  held.used = true;
  const session = crypto.randomBytes(32).toString("base64url");
  sessions.push(sha256(session));
  const secure = req.socket.encrypted || req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
  res.writeHead(303, {
    Location: "/",
    "Cache-Control": "no-store",
    "Set-Cookie": workerData.consoleCookie + "=" + session + "; HttpOnly; SameSite=Strict; Path=/" + secure,
  }).end();
};
const answerFailed = (req, res) => {
  const path = String(req.url).split("?")[0];
  if (req.method === "POST" && path === workerData.consolePath) {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 4096) req.destroy();
    });
    req.on("end", () => openConsole(req, res, new URLSearchParams(body).get("token") || ""));
    return;
  }
  req.resume();
  if (req.method === "POST" && path === workerData.retryPath) {
    if (!hasSession(req)) return answerConsole(res, 403, consoleHold.loginPage);
    consoleHold = null;
    parentPort.postMessage({ type: "retry" });
    res.writeHead(303, { Location: "/", "Cache-Control": "no-store" }).end();
    return;
  }
  if (!String(req.headers.accept || "").includes("text/html")) return answerHolding(req, res);
  answerConsole(res, 503, hasSession(req) ? consoleHold.consolePage : consoleHold.loginPage);
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
  if (consoleHold !== null) {
    answerFailed(req, res);
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
    consoleHold = null;
    if (message.page === null) sessions.length = 0;
    parentPort.postMessage({ type: "held" });
    return;
  }
  if (message.type === "console") {
    holdingPage = message.loginPage;
    consoleHold = {
      loginPage: message.loginPage,
      refusedPage: message.refusedPage,
      consolePage: message.consolePage,
      tokenSha256: Buffer.from(message.tokenSha256, "hex"),
      expiresAt: Date.now() + message.tokenTtlMs,
      used: false,
    };
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
  | { type: "retry" }
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
  /** Shows the failure console; true once a console session pressed Retry, false if it ended. */
  holdConsole: (upgradeConsole: UpgradeConsole) => Promise<boolean>;
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
      consolePath: UPGRADE_CONSOLE_PATH,
      retryPath: UPGRADE_RETRY_PATH,
      consoleCookie: UPGRADE_CONSOLE_COOKIE,
      wrongTokensPerMinute: UPGRADE_CONSOLE_WRONG_TOKENS_PER_MINUTE,
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
      const held = nextMessage({ thread, type: "held" });
      const page = holding === undefined ? null : renderUpgradeHoldingPage(holding);
      thread.postMessage({ type: "hold", page });
      await Promise.race([held, exited]);
    },
    holdConsole: async (upgradeConsole) => {
      const retried = nextMessage({ thread, type: "retry" }).then(() => true);
      thread.postMessage({
        type: "console",
        loginPage: renderUpgradeConsoleLogin({ refused: false }),
        refusedPage: renderUpgradeConsoleLogin({ refused: true }),
        consolePage: renderUpgradeConsole(upgradeConsole),
        tokenSha256: upgradeConsole.tokenSha256,
        tokenTtlMs: upgradeConsole.tokenTtlMs,
      });
      return Promise.race([retried, exited.then(() => false)]);
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

/** Resolves on the thread's next message of `type`. */
function nextMessage({ thread, type }: { thread: Worker; type: ThreadMessage["type"] }) {
  return new Promise<void>((resolve) => {
    const onMessage = (message: ThreadMessage): void => {
      if (message.type !== type) return;
      thread.off("message", onMessage);
      resolve();
    };
    thread.on("message", onMessage);
  });
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

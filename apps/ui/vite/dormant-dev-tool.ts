import { spawn, type ChildProcess } from "child_process";
import http from "http";
import net from "net";
import type { Duplex } from "stream";
import { setTimeout as delay } from "timers/promises";

/**
 * A developer tool (Storybook, the mail preview) held dormant behind its port:
 * started on the first real visit on a loopback port of its own, proxied, and
 * stopped with its whole process group once idle. Haven only routes to the port.
 */

export const DEV_TOOLS_IDLE_ENV = "LANGWATCH_DEV_TOOLS_IDLE";
const DEFAULT_IDLE_MS = 30 * 60_000;
const START_TIMEOUT_MS = 5 * 60_000;
const KILL_GRACE_MS = 5_000;
const BIND_RETRY_MS = 250;
const BIND_RETRIES = 20;
const EXIT_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
const UNIT_MS: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000 };

export type DormantToolState = "dormant" | "starting" | "ready" | "external";

export interface DormantTool {
  state(): DormantToolState;
  /** Starts the tool if it is not running; failures are logged, never thrown. */
  wake(): void;
  close(): void;
}

export interface DormantToolOptions {
  name: string;
  port: number;
  cwd: string;
  command: (params: { port: number }) => { file: string; args: string[] };
  idleAfterMs: number;
  log: (line: string) => void;
}

interface Lane {
  options: DormantToolOptions;
  child?: ChildProcess;
  innerPort?: number;
  starting?: Promise<number>;
  isExternal: boolean;
  closed?: boolean;
  inflight: number;
  lastSeen: number;
}

/** "off" or "0" pins the tools open; "90s", "45m" or "2h" sets the bound; anything else
 * keeps 30 minutes. */
export function idleBoundMs({ value }: { value: string | undefined }): number {
  if (value === "off" || value === "0") return 0;
  const [, amount, unit] = /^(\d+)(s|m|h)$/.exec(value ?? "") ?? [];
  if (amount === undefined) return DEFAULT_IDLE_MS;
  return Number(amount) * (UNIT_MS[unit ?? ""] ?? 0);
}

/** HEAD, OPTIONS, upgrades, Vite's ping and Go health checkers never wake a tool. */
export function isProbe({ req }: { req: http.IncomingMessage }): boolean {
  if (req.method === "HEAD" || req.method === "OPTIONS") return true;
  if (req.headers.upgrade !== undefined || isVitePing({ req })) return true;
  return (req.headers["user-agent"] ?? "").startsWith("Go-http-client");
}

function isVitePing({ req }: { req: http.IncomingMessage }): boolean {
  return (req.headers.accept ?? "").includes("text/x-vite-ping");
}

export function startDormantTool(options: DormantToolOptions): DormantTool {
  const lane: Lane = { options, isExternal: false, inflight: 0, lastSeen: Date.now() };
  const server = http.createServer((req, res) => void handleRequest({ lane, req, res }));
  server.on("upgrade", (req: http.IncomingMessage, socket: Duplex, head: Buffer) =>
    handleUpgrade({ lane, req, socket, head }),
  );
  let retries = 0;
  server.on("error", (error: NodeJS.ErrnoException) => {
    // A restarting dev server may not have released the port yet; retry briefly.
    if (error.code === "EADDRINUSE" && !lane.closed && retries++ < BIND_RETRIES) {
      setTimeout(() => server.listen(options.port, "127.0.0.1"), BIND_RETRY_MS).unref();
      return;
    }
    lane.isExternal = true;
    options.log(
      `${options.name}: :${options.port} is taken (${error.message}); using what answers there`,
    );
  });
  server.listen(options.port, "127.0.0.1");
  const reaper = options.idleAfterMs > 0 ? startReaper({ lane }) : undefined;
  const stopTool = () => {
    lane.closed = true;
    clearInterval(reaper);
    server.close();
    server.closeAllConnections();
    stopLane({ lane, reason: "dev server stopped" });
  };
  const unhook = stopOnExit({ stop: stopTool });
  return {
    state: () => stateOf({ lane }),
    wake: () => void wake({ lane }).catch(() => undefined),
    close: () => {
      unhook();
      stopTool();
    },
  };
}

function stateOf({ lane }: { lane: Lane }): DormantToolState {
  if (lane.isExternal) return "external";
  if (lane.innerPort !== undefined) return "ready";
  return lane.starting ? "starting" : "dormant";
}

async function handleRequest({
  lane,
  req,
  res,
}: {
  lane: Lane;
  req: http.IncomingMessage;
  res: http.ServerResponse;
}): Promise<void> {
  const isVisit = !isProbe({ req });
  if (!isVisit && lane.innerPort === undefined) {
    res.writeHead(isVitePing({ req }) ? 503 : 200).end();
    return;
  }
  if (isVisit) trackVisit({ lane, res });
  try {
    proxyRequest({ port: await wake({ lane }), req, res });
  } catch (error) {
    res
      .writeHead(502, { "content-type": "text/plain" })
      .end(`${lane.options.name} did not start: ${messageOf(error)}`);
  }
}

function trackVisit({ lane, res }: { lane: Lane; res: http.ServerResponse }): void {
  lane.inflight++;
  lane.lastSeen = Date.now();
  res.once("close", () => {
    lane.inflight--;
    lane.lastSeen = Date.now();
  });
}

/** Every concurrent caller shares one start. */
function wake({ lane }: { lane: Lane }): Promise<number> {
  if (lane.innerPort !== undefined) return Promise.resolve(lane.innerPort);
  lane.starting ??= launch({ lane }).finally(() => {
    lane.starting = undefined;
  });
  return lane.starting;
}

async function launch({ lane }: { lane: Lane }): Promise<number> {
  const { name, cwd, command, log } = lane.options;
  const port = await freeLoopbackPort();
  const { file, args } = command({ port });
  log(`${name}: first visit, starting on :${port}`);
  // detached: the tool leads its own process group, so pnpm wrappers and compiler
  // helpers stop with it.
  const child = spawn(file, args, {
    cwd,
    detached: true,
    stdio: ["ignore", "ignore", "inherit"],
    env: process.env,
  });
  lane.child = child;
  child.once("exit", () => forgetChild({ lane, child }));
  try {
    await awaitListening({ port, child });
  } catch (error) {
    log(`${name}: ${messageOf(error)}`);
    stopLane({ lane, reason: "failed to start" });
    throw error;
  }
  lane.innerPort = port;
  lane.lastSeen = Date.now();
  return port;
}

function forgetChild({ lane, child }: { lane: Lane; child: ChildProcess }): void {
  if (lane.child !== child) return;
  lane.child = undefined;
  lane.innerPort = undefined;
}

async function awaitListening({
  port,
  child,
}: {
  port: number;
  child: ChildProcess;
}): Promise<void> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error("exited before it listened");
    if (await isListening({ port })) return;
    await delay(250);
  }
  throw new Error(`not listening on :${port} after ${START_TIMEOUT_MS / 1000}s`);
}

function startReaper({ lane }: { lane: Lane }): NodeJS.Timeout {
  const everyMs = Math.min(Math.max(lane.options.idleAfterMs / 4, 10), 30_000);
  const reaper = setInterval(() => reapIfIdle({ lane }), everyMs);
  reaper.unref();
  return reaper;
}

function reapIfIdle({ lane }: { lane: Lane }): void {
  if (lane.innerPort === undefined || lane.inflight > 0) return;
  const idleMs = Date.now() - lane.lastSeen;
  if (idleMs <= lane.options.idleAfterMs) return;
  stopLane({ lane, reason: `idle for ${Math.round(idleMs / 1000)}s` });
}

function stopLane({ lane, reason }: { lane: Lane; reason: string }): void {
  const { child } = lane;
  lane.child = undefined;
  lane.innerPort = undefined;
  if (child?.pid === undefined) return;
  lane.options.log(`${lane.options.name}: ${reason}, stopped`);
  const pid = child.pid;
  if (!signalGroup({ pid, signal: "SIGTERM" })) return;
  setTimeout(() => signalGroup({ pid, signal: "SIGKILL" }), KILL_GRACE_MS).unref();
}

function signalGroup({ pid, signal }: { pid: number; signal: NodeJS.Signals }): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    return false;
  }
}

/** A detached group outlives its parent, so a stopping dev server takes it down first;
 * returns the unhook. */
function stopOnExit({ stop }: { stop: () => void }): () => void {
  function onSignal(signal: NodeJS.Signals): void {
    unhook();
    stop();
    if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
  }
  function unhook(): void {
    process.off("exit", stop);
    for (const signal of EXIT_SIGNALS) process.off(signal, onSignal);
  }
  process.once("exit", stop);
  for (const signal of EXIT_SIGNALS) process.on(signal, onSignal);
  return unhook;
}

function proxyRequest({
  port,
  req,
  res,
}: {
  port: number;
  req: http.IncomingMessage;
  res: http.ServerResponse;
}): void {
  const upstream = http.request(
    { host: "127.0.0.1", port, method: req.method, path: req.url, headers: req.headers },
    (answer) => {
      res.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(res);
    },
  );
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502);
    res.end();
  });
  req.pipe(upstream);
}

/** A socket to a stopped tool wakes it and is refused; the open tab's client retries and
 * reconnects once the tool answers. */
function handleUpgrade({
  lane,
  req,
  socket,
  head,
}: {
  lane: Lane;
  req: http.IncomingMessage;
  socket: Duplex;
  head: Buffer;
}): void {
  const port = lane.innerPort;
  if (port === undefined) {
    void wake({ lane }).catch(() => undefined);
    socket.end("HTTP/1.1 503 Service Unavailable\r\nretry-after: 2\r\nconnection: close\r\n\r\n");
    return;
  }
  const upstream = net.connect({ port, host: "127.0.0.1" }, () => {
    upstream.write(rawRequestHead({ req }));
    if (head.length > 0) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
}

function rawRequestHead({ req }: { req: http.IncomingMessage }): string {
  const lines = [`${req.method ?? "GET"} ${req.url ?? "/"} HTTP/${req.httpVersion}`];
  for (let i = 0; i + 1 < req.rawHeaders.length; i += 2) {
    lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
  }
  return `${lines.join("\r\n")}\r\n\r\n`;
}

export function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

export function isListening({ port }: { port: number }): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    const done = (answer: boolean) => {
      socket.destroy();
      resolve(answer);
    };
    socket.setTimeout(400);
    socket.on("connect", () => done(true));
    socket.on("timeout", () => done(false));
    socket.on("error", () => done(false));
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

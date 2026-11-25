/**
 * The daemon: a long-lived process holding a warm module graph, a resolved
 * identity, pooled HTTP connections and (later) a persistent OTLP exporter,
 * serving CLI commands over a private Unix domain socket.
 */

import * as fs from "node:fs";
import * as net from "node:net";
import { clearTimeout, setTimeout } from "node:timers";

import { ExecutionWindow, installProcessInterceptors } from "./execution";
import {
  ensureSocketDir,
  inspectSocketTrust,
  isSocketPathUsable,
  secureSocketFile,
  UntrustedSocketDirError,
} from "./identity";
import {
  encodeFrame,
  FrameDecoder,
  PROTOCOL_VERSION,
  type ClientFrame,
  type ServerFrame,
} from "./protocol";
import { createCommandExecutor, type CommandExecutor } from "./runner";
import { noopTelemetry, type DaemonTelemetry } from "./telemetry";

/** 10 minutes: long enough for agent think-time, short enough to never feel
 * like a leak. */
export const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000;

/** Shutdown waits for in-flight requests before tearing down the execution
 * window. 5s covers close-to-finishing commands; past that, client falls back
 * and connection cuts. See stop() for committed output handling. */
export const DEFAULT_SHUTDOWN_GRACE_MS = 5_000;

export interface DaemonServerOptions {
  socketPath: string;
  socketDir: string;
  /** Full identity fingerprint this daemon serves. Any other is refused. */
  fingerprint: string;
  cliVersion: string;
  /** Identity of the code this daemon actually loaded. See resolveBuildId. */
  build: string;
  idleTimeoutMs?: number;
  /** How long `stop()` lets in-flight requests finish. Injectable for tests. */
  shutdownGraceMs?: number;
  telemetry?: DaemonTelemetry;
  /** Injectable for tests; defaults to really running commander. */
  executor?: CommandExecutor;
}

export interface DaemonServer {
  readonly socketPath: string;
  listen(): Promise<void>;
  /** Resolves once the daemon has fully shut down and unlinked its socket. */
  closed(): Promise<void>;
  stop(reason: "idle" | "stop-requested" | "signal"): Promise<void>;
  readonly stats: () => {
    served: number;
    inflight: number;
    uptimeMs: number;
  };
}

/**
 * Trust problems meaning somebody ELSE holds this path, as opposed to ones
 * meaning we just left debris behind (`socket-missing`, or a corpse
 * `cleanStaleSocket` will unlink). Everything else is ownership/mode we can't repair.
 */
const SQUATTED_SOCKET_PROBLEMS: ReadonlySet<string> = new Set([
  "socket-dir-not-a-directory",
  "socket-dir-foreign-owner",
  "socket-dir-loose-mode",
  "socket-foreign-owner",
  "socket-loose-mode",
]);

export class DaemonAlreadyRunningError extends Error {
  constructor(readonly socketPath: string) {
    super(`a langwatch daemon is already listening on ${socketPath}`);
    this.name = "DaemonAlreadyRunningError";
  }
}

/**
 * Is something actually listening, or is this a corpse left by a SIGKILLed
 * daemon? Connecting distinguishes the two, so a crash never wedges future
 * invocations. A socket owned by somebody else counts as not-alive too.
 */
export async function isSocketAlive(socketPath: string): Promise<boolean> {
  if (!fs.existsSync(socketPath)) return false;
  if (inspectSocketTrust(socketPath) !== null) return false;

  return new Promise<boolean>((resolve) => {
    const socket = net.connect(socketPath);
    const done = (alive: boolean): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(alive);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.setTimeout(1_000, () => done(false));
  });
}

/**
 * Which FILE a path pointed at, at a moment in time: the socket path is
 * shared across every daemon, so `unlink(path)` deletes whatever is there NOW,
 * not necessarily what the caller meant. (dev, ino) is the real identity.
 */
export interface FileIdentity {
  dev: number;
  ino: number;
}

/**
 * What NAME `filePath` is right now, or null if nothing holds it. `lstat`,
 * never `stat`: stat gets a dangling symlink wrong (looks clean) and a live
 * one wrong the other way (identifies the target, not the link unlink(2) removes).
 */
function identifyFile(filePath: string): FileIdentity | null {
  try {
    const stat = fs.lstatSync(filePath, { throwIfNoEntry: false });
    return stat ? { dev: stat.dev, ino: stat.ino } : null;
  } catch {
    // A path we cannot even stat is certainly not one we may delete.
    return null;
  }
}

/**
 * Unlink `filePath`, but only while it still holds the file `expected`
 * identified — a process only ever removes a socket it created itself.
 * Deleting somebody else's leaves a live daemon on an unreachable inode forever.
 */
export function unlinkIfSameFile(filePath: string, expected: FileIdentity | null): boolean {
  if (expected === null) return false;

  const current = identifyFile(filePath);
  if (current === null) return false;
  if (current.dev !== expected.dev || current.ino !== expected.ino) {
    return false;
  }

  try {
    fs.unlinkSync(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** Remove a socket file that nothing is listening on. Safe to call always. */
export async function cleanStaleSocket(socketPath: string): Promise<boolean> {
  // Identify the corpse BEFORE probing it, and remove it only if the path
  // still leads to that same file afterwards — `isSocketAlive` can take up to
  // a second, and a daemon starting concurrently can bind the path inside
  // that window, so unlinking by path alone could delete a live daemon's
  // socket on the strength of a stale probe.
  const corpse = identifyFile(socketPath);
  if (corpse === null) return false;
  if (await isSocketAlive(socketPath)) return false;
  return unlinkIfSameFile(socketPath, corpse);
}

/**
 * The private path a daemon BINDS before publishing under the shared one
 * (see `publishSocket`). Pid-scoped so two racing daemons never bind the same
 * file; the `.sock` suffix is REPLACED, not appended, to fit sockaddr_un's limit.
 */
export function stagingSocketPath(socketPath: string, pid: number): string {
  const base = socketPath.endsWith(".sock") ? socketPath.slice(0, -".sock".length) : socketPath;
  return `${base}.${pid}`;
}

/**
 * Give a bound socket its shared name. `link`, not `rename`: link is
 * fail-CLOSED, so a daemon that published first throws EEXIST rather than
 * being silently unlinked by a renaming winner (fallback note below).
 */
export function publishSocket(stagingPath: string, socketPath: string): void {
  try {
    fs.linkSync(stagingPath, socketPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new DaemonAlreadyRunningError(socketPath);
    }

    // link() failed for a reason other than "somebody got there first" (a
    // filesystem that won't hard-link a socket). rename(2) REPLACES whatever
    // holds the target, so only rename onto a name nothing holds — an occupant
    // now means a daemon published concurrently, and renaming over it would orphan it.
    if (identifyFile(socketPath) !== null) {
      throw new DaemonAlreadyRunningError(socketPath);
    }
    fs.renameSync(stagingPath, socketPath);
    return;
  }

  // The socket now answers to the shared name; drop the staging one. (This is
  // also the name libuv will unlink at close, which we want to be a no-op.)
  try {
    fs.unlinkSync(stagingPath);
  } catch {
    // We are published either way, and reporting a failed start over a
    // leftover private name would be a lie. It is 0600 inside our own 0700
    // directory, and the next daemon to inherit this pid sweeps it.
    void 0;
  }
}

export function createDaemonServer(options: DaemonServerOptions): DaemonServer {
  const daemon = new Daemon(options);
  return {
    socketPath: options.socketPath,
    listen: () => daemon.listen(),
    closed: () => daemon.closed,
    stop: (reason) => daemon.stop(reason),
    stats: () => daemon.stats(),
  };
}

type StopReason = "idle" | "stop-requested" | "signal";

/** One daemon's lifetime: its socket, its idle clock and the requests in flight. */
class Daemon {
  readonly options: DaemonServerOptions;
  readonly telemetry: DaemonTelemetry;
  readonly idleTimeoutMs: number;
  readonly startedAt = Date.now();
  readonly executor: CommandExecutor;
  readonly closed: Promise<void>;
  served = 0;
  inflight = 0;
  stopping = false;
  private readonly shutdownGraceMs: number;
  private readonly window = new ExecutionWindow();
  private readonly server = net.createServer();
  private idleTimer: NodeJS.Timeout | undefined;
  private uninstallInterceptors: (() => void) | undefined;
  /**
   * The socket file THIS daemon published, recorded once listening. Every
   * later unlink is checked against it, so shutdown can never remove a
   * successor's socket; a daemon that never got as far as publishing removes nothing.
   */
  private publishedSocket: FileIdentity | null = null;
  /** Live client connections, so shutdown can cut them if a drain times out. */
  private readonly connections = new Set<net.Socket>();
  /** Woken when `inflight` reaches zero. Only `stop()` ever waits on this. */
  private drainWaiters: (() => void)[] = [];
  private resolveClosed: () => void = () => undefined;
  private readonly onSignal = (): void => {
    void this.stop("signal");
  };

  constructor(options: DaemonServerOptions) {
    this.options = options;
    this.telemetry = options.telemetry ?? noopTelemetry;
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.shutdownGraceMs = options.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE_MS;
    this.executor =
      options.executor ?? createCommandExecutor({ window: this.window, telemetry: this.telemetry });
    this.closed = new Promise<void>((resolve) => {
      this.resolveClosed = resolve;
    });
  }

  stats(): { served: number; inflight: number; uptimeMs: number } {
    return { served: this.served, inflight: this.inflight, uptimeMs: Date.now() - this.startedAt };
  }

  /** Counts a request in and stops the idle clock; answers the request's id. */
  beginRequest(): string {
    this.inflight++;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    return `${process.pid}-${++this.served}`;
  }

  /** Counts a request out, restarts the idle clock and wakes any drain. */
  endRequest(): void {
    this.inflight--;
    this.armIdleTimer();
    this.noteRequestSettled();
  }

  track(socket: net.Socket): void {
    this.connections.add(socket);
  }

  untrack(socket: net.Socket): void {
    this.connections.delete(socket);
  }

  private armIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.stopping || this.inflight > 0) return;
    this.idleTimer = setTimeout(() => {
      void this.stop("idle");
    }, this.idleTimeoutMs);
    // Never let the idle timer alone hold the process open.
    this.idleTimer.unref();
  }

  /** Called on every request completion; wakes a shutdown waiting to drain. */
  private noteRequestSettled(): void {
    if (this.inflight > 0) return;
    const waiters = this.drainWaiters;
    this.drainWaiters = [];
    for (const wake of waiters) wake();
  }

  /** Resolves true if everything finished in time, false if the grace ran out. */
  private async drainInflight(graceMs: number): Promise<boolean> {
    if (this.inflight === 0) return true;
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), graceMs);
      timer.unref();
      this.drainWaiters.push(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  async stop(reason: StopReason): Promise<void> {
    if (this.stopping) return this.closed;
    this.stopping = true;
    if (this.idleTimer) clearTimeout(this.idleTimer);

    this.telemetry.daemonStopping({
      pid: process.pid,
      socketPath: this.options.socketPath,
      cliVersion: this.options.cliVersion,
      reason,
    });

    // Unlinking here makes the next client see "no daemon" rather than a
    // corpse to probe, only while the path still leads to the file WE
    // published. Done BEFORE `server.close()`: once we drop our own reference
    // the inode number can be reused immediately, so this guard would fool itself.
    try {
      unlinkIfSameFile(this.options.socketPath, this.publishedSocket);
    } catch {
      // A filesystem refusal (EACCES, EPERM, a directory removed under us).
      // Shutdown proceeds; the next client's liveness probe cleans the corpse.
      void 0;
    }
    this.server.close();

    // `window.reset()` below restores the daemon's OWN cwd and environment. A
    // request still executing when that lands would read its paths and
    // credentials against the daemon's globals. So: let them finish.
    if (!(await this.drainInflight(this.shutdownGraceMs))) this.cutConnections();

    // The one place a telemetry flush is both necessary and possible.
    await this.telemetry.shutdown();
    this.uninstallInterceptors?.();
    process.removeListener("SIGTERM", this.onSignal);
    process.removeListener("SIGINT", this.onSignal);
    this.window.reset();
    this.resolveClosed();
    return this.closed;
  }

  /**
   * The drain timed out. The `fallback` frame goes first so the outcome is
   * DIAGNOSED, not inferred from a dead socket. `end`, not `write`+`destroy`:
   * destroy() discards the write buffer, which would throw the frame away.
   */
  private cutConnections(): void {
    for (const connection of this.connections) {
      if (connection.destroyed) continue;
      connection.end(encodeFrame({ t: "fallback", reason: "shutting-down-mid-command" }), () =>
        connection.destroy(),
      );
    }
    this.connections.clear();
  }

  async listen(): Promise<void> {
    const { options } = this;
    const stagingPath = stagingSocketPath(options.socketPath, process.pid);
    await prepareSocketPath({
      socketPath: options.socketPath,
      socketDir: options.socketDir,
      stagingPath,
    });

    // Only patch the process globals once we are actually going to serve.
    this.uninstallInterceptors = installProcessInterceptors();

    this.server.on("connection", (socket: net.Socket) => {
      new DaemonConnection({ daemon: this, socket }).attach();
    });

    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(stagingPath, () => {
        this.server.removeListener("error", reject);
        resolve();
      });
    });

    // listen() creates the socket connectable by any local user; tightening it
    // while it only answers to the private name leaves no loose instant.
    secureSocketFile(stagingPath);

    // Our identity, taken from the name only WE can hold, before the shared one
    // is in play; read back after publishing, a replaced name would read as ours.
    const mine = identifyFile(stagingPath);

    try {
      publishSocket(stagingPath, options.socketPath);
    } catch (error) {
      // We are not the daemon after all: give the globals back and close the
      // handle, so losing the race leaves nothing behind but the winner.
      this.uninstallInterceptors?.();
      this.uninstallInterceptors = undefined;
      this.server.close();
      throw error;
    }

    this.publishedSocket = mine;

    // Only once we are actually serving: a daemon that lost the race to bind
    // must not install handlers it will never remove.
    process.once("SIGTERM", this.onSignal);
    process.once("SIGINT", this.onSignal);

    this.telemetry.daemonStarted({
      pid: process.pid,
      socketPath: options.socketPath,
      cliVersion: options.cliVersion,
    });

    this.armIdleTimer();
  }
}

/**
 * Refuses a path that cannot be bound or that a squatter holds, then clears
 * the debris of a dead predecessor under both names.
 */
async function prepareSocketPath({
  socketPath,
  socketDir,
  stagingPath,
}: {
  socketPath: string;
  socketDir: string;
  stagingPath: string;
}): Promise<void> {
  // Name the path that ACTUALLY failed. The staging path is the longer of the
  // two (a pid stands in for `.sock`), so it is the one that overflows first.
  const tooLong = [socketPath, stagingPath].find((candidate) => !isSocketPathUsable(candidate));
  if (tooLong !== undefined) {
    throw new Error(`socket path is too long for a unix domain socket: ${tooLong}`);
  }

  ensureSocketDir(socketDir);

  // ensureSocketDir repairs the DIRECTORY's mode, but a squatter who got there
  // while it was still loose has left their socket file inside it. Refusing
  // loudly keeps the squat from reading as "a daemon is already running".
  const trust = inspectSocketTrust(socketPath);
  if (trust !== null && SQUATTED_SOCKET_PROBLEMS.has(trust)) {
    throw new UntrustedSocketDirError(socketPath, trust);
  }

  if (await isSocketAlive(socketPath)) {
    throw new DaemonAlreadyRunningError(socketPath);
  }
  await cleanStaleSocket(socketPath);
  // And our own staging path: only one process holds a pid at a time, so a
  // file there is the debris of a dead predecessor that inherited this pid.
  await cleanStaleSocket(stagingPath);
}

type HelloFrame = Extract<ClientFrame, { t: "hello" }>;
type ExecFrame = Extract<ClientFrame, { t: "exec" }>;

/**
 * Why a hello is refused, in the order the checks run: protocol skew, a build
 * from another install, another identity, or a daemon on its way out.
 */
function helloRefusal({
  frame,
  options,
  stopping,
}: {
  frame: HelloFrame;
  options: DaemonServerOptions;
  stopping: boolean;
}): "protocol-skew" | "version-skew" | "identity-mismatch" | "shutting-down" | undefined {
  if (frame.protocol !== PROTOCOL_VERSION) return "protocol-skew";
  // Compare the build, not just the semver: it does not move on a rebuild.
  if (frame.build !== options.build) return "version-skew";
  // Defence in depth on top of the per-identity socket path.
  if (frame.fingerprint !== options.fingerprint) return "identity-mismatch";
  if (stopping) return "shutting-down";
  return undefined;
}

/** One client connection: its handshake, its frames and the request it runs. */
class DaemonConnection {
  private readonly daemon: Daemon;
  private readonly socket: net.Socket;
  private readonly decoder = new FrameDecoder<ClientFrame>();
  private handshaken = false;
  private execution: { cancel: (code: number) => void } | undefined;
  private counted = false;

  constructor({ daemon, socket }: { daemon: Daemon; socket: net.Socket }) {
    this.daemon = daemon;
    this.socket = socket;
  }

  attach(): void {
    const { socket } = this;
    this.daemon.track(socket);
    socket.on("error", () => {
      // A client that vanished (Ctrl-C, killed shell). Cancel its work so the
      // daemon does not keep an abandoned command's window held open.
      this.execution?.cancel(130);
    });
    socket.on("close", () => {
      this.daemon.untrack(socket);
      this.execution?.cancel(130);
    });
    socket.on("data", (chunk: Buffer) => this.receive(chunk));
  }

  private receive(chunk: Buffer): void {
    let frames: ClientFrame[];
    try {
      frames = this.decoder.push(chunk);
    } catch {
      this.finish();
      return;
    }
    for (const frame of frames) {
      try {
        this.handleFrame(frame);
      } catch {
        this.endRequest();
        this.send({ t: "fallback", reason: "daemon-error" });
        this.finish();
      }
    }
  }

  /** This connection's request is done: uncount it and wake any drain. */
  private endRequest(): void {
    if (!this.counted) return;
    this.counted = false;
    this.daemon.endRequest();
  }

  private send(frame: ServerFrame): void {
    if (this.socket.destroyed) return;
    this.socket.write(encodeFrame(frame));
  }

  private finish(): void {
    if (!this.socket.destroyed) this.socket.end();
  }

  private handleFrame(frame: ClientFrame): void {
    switch (frame.t) {
      case "hello":
        return this.hello(frame);
      case "status":
        return this.status();
      case "stop":
        this.finish();
        void this.daemon.stop("stop-requested");
        return;
      case "cancel":
        this.execution?.cancel(130);
        return;
      case "exec":
        return this.exec(frame);
    }
  }

  private hello(frame: HelloFrame): void {
    const { options } = this.daemon;
    const reason = helloRefusal({ frame, options, stopping: this.daemon.stopping });
    if (reason !== undefined) {
      this.send({ t: "hello-err", reason, cliVersion: options.cliVersion });
      this.finish();
      return;
    }
    this.handshaken = true;
    this.send({
      t: "hello-ok",
      protocol: PROTOCOL_VERSION,
      cliVersion: options.cliVersion,
      build: options.build,
      pid: process.pid,
    });
  }

  private status(): void {
    const { daemon } = this;
    this.send({
      t: "status-ok",
      pid: process.pid,
      cliVersion: daemon.options.cliVersion,
      protocol: PROTOCOL_VERSION,
      socketPath: daemon.options.socketPath,
      uptimeMs: Date.now() - daemon.startedAt,
      idleTimeoutMs: daemon.idleTimeoutMs,
      served: daemon.served,
      inflight: daemon.inflight,
    });
    this.finish();
  }

  private exec(frame: ExecFrame): void {
    if (!this.handshaken || this.daemon.stopping) {
      this.send({ t: "fallback", reason: this.handshaken ? "shutting-down" : "no-handshake" });
      this.finish();
      return;
    }
    this.counted = true;
    const requestId = this.daemon.beginRequest();
    const running = this.daemon.executor({
      requestId,
      args: frame.args,
      cwd: frame.cwd,
      env: frame.env,
      colorLevel: frame.colorLevel,
      bin: frame.bin,
      sink: (stream, chunk) => {
        const d = chunk.toString("base64");
        this.send(stream === "stdout" ? { t: "out", d } : { t: "err", d });
      },
    });
    this.execution = running;
    running.completed
      .then((code) => {
        this.send({ t: "exit", code });
        this.finish();
        this.endRequest();
      })
      .catch((error: unknown) => {
        // The window could not be applied, almost always because the caller's
        // cwd was deleted. No output yet, so the client can run it itself.
        this.send({
          t: "fallback",
          reason: error instanceof Error ? error.message : "execution-failed",
        });
        this.finish();
        this.endRequest();
      });
  }
}

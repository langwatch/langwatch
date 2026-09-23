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
  const telemetry = options.telemetry ?? noopTelemetry;
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  const shutdownGraceMs = options.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE_MS;
  const startedAt = Date.now();

  const window = new ExecutionWindow();
  const executor = options.executor ?? createCommandExecutor({ window, telemetry });

  let served = 0;
  let inflight = 0;
  let stopping = false;
  let idleTimer: NodeJS.Timeout | undefined;
  let uninstallInterceptors: (() => void) | undefined;
  /**
   * The socket file THIS daemon published, recorded once listening. Every
   * later unlink is checked against it, so shutdown can never remove a
   * successor's socket; a daemon that never got as far as publishing removes nothing.
   */
  let publishedSocket: FileIdentity | null = null;
  /** Live client connections, so shutdown can cut them if a drain times out. */
  const connections = new Set<net.Socket>();
  /** Woken when `inflight` reaches zero. Only `stop()` ever waits on this. */
  let drainWaiters: (() => void)[] = [];

  const server = net.createServer();
  let resolveClosed: () => void;
  const closedPromise = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });

  const armIdleTimer = (): void => {
    if (idleTimer) clearTimeout(idleTimer);
    if (stopping || inflight > 0) return;
    idleTimer = setTimeout(() => {
      void stop("idle");
    }, idleTimeoutMs);
    // Never let the idle timer alone hold the process open.
    idleTimer.unref();
  };

  /** Called on every request completion; wakes a shutdown waiting to drain. */
  const noteRequestSettled = (): void => {
    if (inflight > 0) return;
    const waiters = drainWaiters;
    drainWaiters = [];
    for (const wake of waiters) wake();
  };

  /** Resolves true if everything finished in time, false if the grace ran out. */
  const drainInflight = async (graceMs: number): Promise<boolean> => {
    if (inflight === 0) return true;
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), graceMs);
      timer.unref();
      drainWaiters.push(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  };

  const stop = async (reason: "idle" | "stop-requested" | "signal"): Promise<void> => {
    if (stopping) return closedPromise;
    stopping = true;
    if (idleTimer) clearTimeout(idleTimer);

    telemetry.daemonStopping({
      pid: process.pid,
      socketPath: options.socketPath,
      cliVersion: options.cliVersion,
      reason,
    });

    // Unlinking here makes the next client see "no daemon" rather than a
    // corpse to probe — only while the path still leads to the file WE
    // published, or a rebound successor's socket could be killed on the way
    // out. Done BEFORE `server.close()`: once we drop our own reference the
    // inode number can be reused immediately, so this guard would fool itself.
    try {
      unlinkIfSameFile(options.socketPath, publishedSocket);
    } catch {
      // Not "already gone" and not "we never published" — both of those return
      // false rather than throwing. What lands here is the residual class: a
      // filesystem refusal (EACCES, EPERM, a directory removed under us).
      // Shutdown proceeds regardless; a socket we could not unlink is a corpse
      // the next client's liveness probe cleans up.
      void 0;
    }
    server.close();

    // `window.reset()` below restores the daemon's OWN cwd and environment. A
    // request still executing when that lands would resolve its paths and read
    // its credentials against the daemon's globals instead of its caller's, and
    // would then report an exit code the client trusts. So: let them finish.
    if (!(await drainInflight(shutdownGraceMs))) {
      // They did not. Cut the connections rather than let clients believe a
      // result computed under a rewritten environment. The `fallback` frame goes
      // first so the outcome is DIAGNOSED, not inferred from a dead socket: if
      // output already crossed DEFAULT_MAX_BUFFER_BYTES, the client reports
      // truncated output with a non-command status instead of re-running unsafely.
      for (const connection of connections) {
        if (connection.destroyed) continue;
        // `end`, not `write`+`destroy`: destroy() discards anything still in the
        // write buffer, which would throw away the very frame being sent. The
        // callback fires once it is flushed, and destroying there bounds the
        // teardown instead of leaving a half-closed socket holding the loop open.
        connection.end(encodeFrame({ t: "fallback", reason: "shutting-down-mid-command" }), () =>
          connection.destroy(),
        );
      }
      connections.clear();
    }

    // The one place a telemetry flush is both necessary and possible.
    await telemetry.shutdown();
    uninstallInterceptors?.();
    process.removeListener("SIGTERM", onSignal);
    process.removeListener("SIGINT", onSignal);
    window.reset();
    resolveClosed();
    return closedPromise;
  };

  const handleConnection = (socket: net.Socket): void => {
    const decoder = new FrameDecoder<ClientFrame>();
    let handshaken = false;
    let execution: { cancel: (code: number) => void } | undefined;
    let counted = false;

    connections.add(socket);

    /** This connection's request is done: uncount it and wake any drain. */
    const endRequest = (): void => {
      if (!counted) return;
      counted = false;
      inflight--;
      armIdleTimer();
      noteRequestSettled();
    };

    const send = (frame: ServerFrame): void => {
      if (socket.destroyed) return;
      socket.write(encodeFrame(frame));
    };

    const finish = (): void => {
      if (!socket.destroyed) socket.end();
    };

    socket.on("error", () => {
      // A client that vanished (Ctrl-C, killed shell). Cancel its work so the
      // daemon does not keep an abandoned command's window held open.
      execution?.cancel(130);
    });

    socket.on("close", () => {
      connections.delete(socket);
      execution?.cancel(130);
    });

    const handleFrame = (frame: ClientFrame): void => {
      switch (frame.t) {
        case "hello": {
          if (frame.protocol !== PROTOCOL_VERSION) {
            send({
              t: "hello-err",
              reason: "protocol-skew",
              cliVersion: options.cliVersion,
            });
            finish();
            return;
          }
          // Version skew: a daemon left over from a previous install — or from
          // before the developer's last rebuild — would silently serve OLD
          // behaviour to a NEW client. Compare the build, not just the semver:
          // the semver does not move when the bundle is rebuilt.
          if (frame.build !== options.build) {
            send({
              t: "hello-err",
              reason: "version-skew",
              cliVersion: options.cliVersion,
            });
            finish();
            return;
          }
          // Defence in depth on top of the per-identity socket path: even a
          // stale socket file or a truncated-hash collision cannot make us
          // serve another identity's request with this identity's credentials.
          if (frame.fingerprint !== options.fingerprint) {
            send({
              t: "hello-err",
              reason: "identity-mismatch",
              cliVersion: options.cliVersion,
            });
            finish();
            return;
          }
          if (stopping) {
            send({
              t: "hello-err",
              reason: "shutting-down",
              cliVersion: options.cliVersion,
            });
            finish();
            return;
          }

          handshaken = true;
          send({
            t: "hello-ok",
            protocol: PROTOCOL_VERSION,
            cliVersion: options.cliVersion,
            build: options.build,
            pid: process.pid,
          });
          return;
        }

        case "status": {
          send({
            t: "status-ok",
            pid: process.pid,
            cliVersion: options.cliVersion,
            protocol: PROTOCOL_VERSION,
            socketPath: options.socketPath,
            uptimeMs: Date.now() - startedAt,
            idleTimeoutMs,
            served,
            inflight,
          });
          finish();
          return;
        }

        case "stop": {
          finish();
          void stop("stop-requested");
          return;
        }

        case "cancel": {
          execution?.cancel(130);
          return;
        }

        case "exec": {
          if (!handshaken) {
            send({ t: "fallback", reason: "no-handshake" });
            finish();
            return;
          }
          if (stopping) {
            send({ t: "fallback", reason: "shutting-down" });
            finish();
            return;
          }

          inflight++;
          counted = true;
          if (idleTimer) clearTimeout(idleTimer);

          const requestId = `${process.pid}-${++served}`;
          const running = executor({
            requestId,
            args: frame.args,
            cwd: frame.cwd,
            env: frame.env,
            colorLevel: frame.colorLevel,
            bin: frame.bin,
            sink: (stream, chunk) => {
              send(
                stream === "stdout"
                  ? { t: "out", d: chunk.toString("base64") }
                  : { t: "err", d: chunk.toString("base64") },
              );
            },
          });
          execution = running;

          running.completed
            .then((code) => {
              send({ t: "exit", code });
              finish();
              endRequest();
            })
            .catch((error: unknown) => {
              // The window could not be applied — almost always because the
              // caller's cwd was deleted. No output has been produced, so the
              // client can safely run the command itself.
              send({
                t: "fallback",
                reason: error instanceof Error ? error.message : "execution-failed",
              });
              finish();
              endRequest();
            });
          return;
        }
      }
    };

    socket.on("data", (chunk: Buffer) => {
      let frames: ClientFrame[];
      try {
        frames = decoder.push(chunk);
      } catch {
        finish();
        return;
      }
      for (const frame of frames) {
        try {
          handleFrame(frame);
        } catch {
          endRequest();
          send({ t: "fallback", reason: "daemon-error" });
          finish();
        }
      }
    });
  };

  const listen = async (): Promise<void> => {
    // The staging path is the one actually handed to bind(), so it is the one
    // that has to fit sockaddr_un.
    const stagingPath = stagingSocketPath(options.socketPath, process.pid);
    // Name the path that ACTUALLY failed. The staging path is the longer of the
    // two (a pid stands in for `.sock`), so it is the one that overflows first —
    // and reporting the shared path there printed a path the reader can measure
    // for themselves and find to be within the limit.
    let tooLong: string | null = null;
    if (!isSocketPathUsable(options.socketPath)) {
      tooLong = options.socketPath;
    } else if (!isSocketPathUsable(stagingPath)) {
      tooLong = stagingPath;
    }
    if (tooLong !== null) {
      throw new Error(`socket path is too long for a unix domain socket: ${tooLong}`);
    }

    ensureSocketDir(options.socketDir);

    // ensureSocketDir repairs the DIRECTORY's mode, but a squatter who got there
    // while it was still loose has already left their socket file inside it,
    // and that file is still theirs. Refusing loudly here — rather than letting
    // `listen()` misread it as DaemonAlreadyRunningError — keeps the squat from
    // reading as "a daemon is already running" forever, which restarting can't fix.
    const trust = inspectSocketTrust(options.socketPath);
    if (trust !== null && SQUATTED_SOCKET_PROBLEMS.has(trust)) {
      throw new UntrustedSocketDirError(options.socketPath, trust);
    }

    if (await isSocketAlive(options.socketPath)) {
      throw new DaemonAlreadyRunningError(options.socketPath);
    }
    await cleanStaleSocket(options.socketPath);
    // And our own staging path, in the rare case a daemon was killed between
    // binding and publishing and this process inherited its pid. Only one
    // process holds a pid at a time, so a file there is definitionally the
    // debris of a dead predecessor, never a live daemon's socket. Costs
    // nothing when it does not exist, which is essentially always.
    await cleanStaleSocket(stagingPath);

    // Only patch the process globals once we are actually going to serve.
    uninstallInterceptors = installProcessInterceptors();

    server.on("connection", handleConnection);

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(stagingPath, () => {
        server.removeListener("error", reject);
        resolve();
      });
    });

    // listen() creates the socket with 0755 & ~umask, i.e. connectable by any
    // local user. Doing this while it still only answers to the private name
    // means there is no instant at which a loose socket is reachable under the
    // shared path every client dials.
    secureSocketFile(stagingPath);

    // Our identity, taken from the name only WE can hold, before the shared one
    // is in play. Reading it back off the shared path after publishing looks
    // equivalent and is not: anything that replaced that name in the gap would
    // be recorded as ours, and `stop()` would later delete a stranger's live
    // socket — the exact outage `unlinkIfSameFile` exists to prevent.
    const mine = identifyFile(stagingPath);

    try {
      publishSocket(stagingPath, options.socketPath);
    } catch (error) {
      // We are not the daemon after all. Give the globals back and close the
      // handle — libuv takes the staging socket file with it — so losing the
      // race leaves nothing behind but the winner.
      uninstallInterceptors?.();
      uninstallInterceptors = undefined;
      server.close();
      throw error;
    }

    publishedSocket = mine;

    // Only once we are actually serving: a daemon that lost the race to bind
    // must not install handlers it will never remove.
    process.once("SIGTERM", onSignal);
    process.once("SIGINT", onSignal);

    telemetry.daemonStarted({
      pid: process.pid,
      socketPath: options.socketPath,
      cliVersion: options.cliVersion,
    });

    armIdleTimer();
  };

  const onSignal = (): void => {
    void stop("signal");
  };

  return {
    socketPath: options.socketPath,
    listen,
    closed: () => closedPromise,
    stop,
    stats: () => ({ served, inflight, uptimeMs: Date.now() - startedAt }),
  };
}

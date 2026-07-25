/**
 * The daemon: a long-lived process holding a warm module graph, a resolved
 * identity, pooled HTTP connections and (later) a persistent OTLP exporter,
 * serving CLI commands over a private Unix domain socket.
 */

import * as fs from "node:fs";
import * as net from "node:net";

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
import { ExecutionWindow, installProcessInterceptors } from "./execution";
import { createCommandExecutor, type CommandExecutor } from "./runner";
import { noopTelemetry, type DaemonTelemetry } from "./telemetry";

/** 10 minutes: long enough to span an agent's think-time, short enough to never feel like a leak. */
export const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * How long `stop()` waits for in-flight requests before tearing the execution
 * window down underneath them.
 *
 * Shutdown restores the daemon's own cwd and environment (ExecutionWindow.reset),
 * so a request still running when that happens would finish against the WRONG
 * globals — and version-skew eviction makes shutdown-while-serving a routine
 * dev-loop event, not an exotic one. 5s covers any command close enough to
 * finishing to be worth waiting for; past that the client is told to fall back
 * and the connection is cut.
 *
 * For a client that has not committed output — everything under the client's
 * buffer cap, which is very nearly everything — that is a clean in-process
 * re-run. For one that HAS committed, it is not: see the note in `stop()`.
 */
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
 * The trust problems that mean somebody ELSE holds this path, as opposed to the
 * ones that just mean we left debris behind.
 *
 * `socket-missing` is the ordinary empty state, and `socket-not-a-socket` is a
 * corpse `cleanStaleSocket` will unlink — neither is a squat. (A non-socket we
 * do NOT own cannot occur past `ensureSocketDir`: the directory is ours and
 * 0700 by then, so nobody else can create a file inside it, and a foreign
 * directory has already thrown.) Everything left is an ownership or mode
 * problem, i.e. a path we can neither trust nor repair.
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
 * Is something actually listening on this socket, or is it a corpse?
 *
 * A daemon that is SIGKILLed (or whose machine loses power) leaves its socket
 * file behind. Binding on top of it fails with EADDRINUSE, and connecting to it
 * fails with ECONNREFUSED. Distinguishing the two is what keeps a crashed
 * daemon from wedging every future invocation.
 *
 * A socket owned by somebody else is neither: it is not OUR daemon, so "alive"
 * would be a lie with teeth. `listen()` turns a true here into
 * DaemonAlreadyRunningError, so a squatter who binds the path first — reachable
 * via LANGWATCH_DAEMON_DIR, XDG_RUNTIME_DIR or the tmp fallback — would stop
 * the real daemon from EVER starting. Nothing is disclosed (we send no bytes),
 * but the old credential-theft vector would become a permanent, silent denial
 * of service. So: a foreign socket is not alive, and it is not silent either —
 * `cleanStaleSocket` will not unlink it (it cannot), and `listen()` reports the
 * squat instead of misattributing it to a daemon that is already running.
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

/** Remove a socket file that nothing is listening on. Safe to call always. */
export async function cleanStaleSocket(socketPath: string): Promise<boolean> {
  if (!fs.existsSync(socketPath)) return false;
  if (await isSocketAlive(socketPath)) return false;
  try {
    fs.unlinkSync(socketPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export function createDaemonServer(options: DaemonServerOptions): DaemonServer {
  const telemetry = options.telemetry ?? noopTelemetry;
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  const shutdownGraceMs = options.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE_MS;
  const startedAt = Date.now();

  const window = new ExecutionWindow();
  const executor =
    options.executor ?? createCommandExecutor({ window, telemetry });

  let served = 0;
  let inflight = 0;
  let stopping = false;
  let idleTimer: NodeJS.Timeout | undefined;
  let uninstallInterceptors: (() => void) | undefined;
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

  const stop = async (
    reason: "idle" | "stop-requested" | "signal",
  ): Promise<void> => {
    if (stopping) return closedPromise;
    stopping = true;
    if (idleTimer) clearTimeout(idleTimer);

    telemetry.daemonStopping({
      pid: process.pid,
      socketPath: options.socketPath,
      cliVersion: options.cliVersion,
      reason,
    });

    server.close();
    // The daemon is the only writer of its socket file; unlinking it here (not
    // just closing the server) is what makes the next client see "no daemon"
    // rather than a corpse it has to probe.
    try {
      fs.unlinkSync(options.socketPath);
    } catch {
      // Already gone — someone cleaned up a stale file, or we never bound.
    }

    // `window.reset()` below restores the daemon's OWN cwd and environment. A
    // request still executing when that lands would resolve its paths and read
    // its credentials against the daemon's globals instead of its caller's, and
    // would then report an exit code the client trusts. So: let them finish.
    if (!(await drainInflight(shutdownGraceMs))) {
      // They did not. Cut the connections rather than let the clients believe a
      // result computed under a rewritten environment.
      //
      // The `fallback` frame goes first so the outcome is DIAGNOSED rather than
      // inferred from a dead socket. What the client can do with it depends on
      // whether it has committed output yet, and the two cases are genuinely
      // different — this is not a uniformly clean re-run:
      //
      //   - Not committed (the overwhelming majority: everything under
      //     DEFAULT_MAX_BUFFER_BYTES is still sitting in the client's buffer).
      //     Nothing has reached the caller's stdout, so the client re-runs the
      //     command in-process and the outcome is indistinguishable from having
      //     no daemon at all. This case IS always correct.
      //
      //   - Committed (`trace search`, `analytics query`, a large
      //     `--format json` — anything whose output crossed the buffer cap and
      //     was flushed to the real stdout). Re-running would duplicate what the
      //     caller has already seen, so the client cannot. It reports truncated
      //     output and a non-zero status that is NOT the command's own. That is
      //     a real, if rare, loss of fidelity, and routine version-skew eviction
      //     (dispatch.ts requestStop) can trigger it. The frame at least lets
      //     the client say so accurately instead of guessing from a socket close.
      for (const connection of connections) {
        if (connection.destroyed) continue;
        // `end`, not `write`+`destroy`: destroy() discards anything still in the
        // write buffer, which would throw away the very frame being sent. The
        // callback fires once it is flushed, and destroying there bounds the
        // teardown instead of leaving a half-closed socket holding the loop open.
        connection.end(
          encodeFrame({ t: "fallback", reason: "shutting-down-mid-command" }),
          () => connection.destroy(),
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
            sink: (stream, chunk) => {
              send(
                stream === "stdout"
                  ? { t: "out", d: chunk.toString("base64") }
                  : { t: "err", d: chunk.toString("base64") },
              );
            },
          });
          execution = running;

          running.completed.then(
            (code) => {
              send({ t: "exit", code });
              finish();
              endRequest();
            },
            (error: unknown) => {
              // The window could not be applied — almost always because the
              // caller's cwd was deleted. No output has been produced, so the
              // client can safely run the command itself.
              send({
                t: "fallback",
                reason:
                  error instanceof Error ? error.message : "execution-failed",
              });
              finish();
              endRequest();
            },
          );
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
    if (!isSocketPathUsable(options.socketPath)) {
      throw new Error(
        `socket path is too long for a unix domain socket: ${options.socketPath}`,
      );
    }

    ensureSocketDir(options.socketDir);

    // ensureSocketDir repairs the DIRECTORY's mode, but a squatter who got
    // there while it was still loose has already left their socket file inside
    // it, and that file is still theirs. Refusing loudly here — rather than
    // letting `isSocketAlive` report it and `listen()` misread it as
    // DaemonAlreadyRunningError — is what keeps the squat from reading as "a
    // daemon is already running" forever, which no amount of restarting fixes.
    const trust = inspectSocketTrust(options.socketPath);
    if (trust !== null && SQUATTED_SOCKET_PROBLEMS.has(trust)) {
      throw new UntrustedSocketDirError(options.socketPath, trust);
    }

    if (await isSocketAlive(options.socketPath)) {
      throw new DaemonAlreadyRunningError(options.socketPath);
    }
    await cleanStaleSocket(options.socketPath);

    // Only patch the process globals once we are actually going to serve.
    uninstallInterceptors = installProcessInterceptors();

    server.on("connection", handleConnection);

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.socketPath, () => {
        server.removeListener("error", reject);
        resolve();
      });
    });

    // listen() creates the socket with 0755 & ~umask. Until this chmod lands,
    // any local user could connect to a process holding our credentials.
    secureSocketFile(options.socketPath);

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

/**
 * The daemon: a long-lived process holding a warm module graph, a resolved
 * identity, pooled HTTP connections and (later) a persistent OTLP exporter,
 * serving CLI commands over a private Unix domain socket.
 */

import * as fs from "node:fs";
import * as net from "node:net";

import {
  ensureSocketDir,
  isSocketPathUsable,
  secureSocketFile,
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

export interface DaemonServerOptions {
  socketPath: string;
  socketDir: string;
  /** Full identity fingerprint this daemon serves. Any other is refused. */
  fingerprint: string;
  cliVersion: string;
  /** Identity of the code this daemon actually loaded. See resolveBuildId. */
  build: string;
  idleTimeoutMs?: number;
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
 */
export async function isSocketAlive(socketPath: string): Promise<boolean> {
  if (!fs.existsSync(socketPath)) return false;

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
  const startedAt = Date.now();

  const window = new ExecutionWindow();
  const executor =
    options.executor ?? createCommandExecutor({ window, telemetry });

  let served = 0;
  let inflight = 0;
  let stopping = false;
  let idleTimer: NodeJS.Timeout | undefined;
  let uninstallInterceptors: (() => void) | undefined;

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
              inflight--;
              counted = false;
              armIdleTimer();
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
              inflight--;
              counted = false;
              armIdleTimer();
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
          if (counted) {
            inflight--;
            counted = false;
            armIdleTimer();
          }
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

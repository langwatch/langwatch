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
 *
 * "A corpse `cleanStaleSocket` will unlink" covers both shapes
 * `socket-not-a-socket` can take inside a directory only we can write: a plain
 * file, and a symlink — including a DANGLING one, which `identifyFile` resolves
 * via `lstat` precisely so this claim stays true. It once did not: the dangling
 * case identified nothing, so nothing was unlinked, and `listen()` walked into
 * a permanent EEXIST at publish time.
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

/**
 * Which FILE a path pointed at, at a moment in time.
 *
 * The socket path is shared by every daemon this identity ever runs, so "the
 * socket at this path" is not an identity — `unlink(path)` deletes whatever is
 * there NOW, which need not be the thing the caller meant. (dev, ino) is the
 * identity; the path is only a name that currently happens to lead to it.
 */
export interface FileIdentity {
  dev: number;
  ino: number;
}

/**
 * What NAME `filePath` is right now, or null if nothing holds it.
 *
 * `lstat`, never `stat`, because the question every caller here is really
 * asking is "what would `unlink(2)` remove, and does `link(2)`/`bind(2)` find
 * this name taken?" — both of which are answered by the directory ENTRY, not by
 * whatever it may resolve to.
 *
 * That matters in two ways, and only `lstat` gets both right:
 *
 *   - A DANGLING SYMLINK is a name that exists (`link(2)` and `bind(2)` fail
 *     EEXIST/EADDRINUSE on it) while `stat` reports nothing at all. Under
 *     `stat`, `cleanStaleSocket` identified no corpse, unlinked nothing, and
 *     every daemon from then on died at `publishSocket` with EEXIST — which
 *     `daemon.ts` reads as "we lost a start race" and swallows in silence. One
 *     dangling link wedged the daemon permanently, with no output on any
 *     invocation, forever.
 *   - A LIVE SYMLINK is the mirror image. `stat` succeeds there, so the
 *     identity recorded is the TARGET's — but `unlink(2)` removes the link and
 *     never the target, so `unlinkIfSameFile` would be guarding an inode the
 *     call it authorises does not touch. Two different links to one target
 *     compare equal; one link repointed between the identify and the unlink
 *     compares unequal. Both answers are wrong, in opposite directions.
 *
 * `lstat` collapses the two into one rule: the link's own (dev, ino) is exactly
 * the file `unlink(2)` deletes, and a name that gains a target, or loses one,
 * between the identify and the unlink still reports the same inode — because
 * the entry itself did not change. `lstat` also succeeds everywhere `stat` does
 * (plus on symlink loops, where `stat` returns ELOOP), so nothing is lost.
 *
 * Neither the socket nor the staging path is ever a symlink of OUR making; the
 * symlink cases are debris `inspectSocketTrust` classifies as
 * `socket-not-a-socket` and this module then has to be able to clean up.
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
 * identified. Reports whether it removed anything.
 *
 * This is the module's one deletion primitive, and it exists so a single rule
 * holds everywhere: a process only ever removes a socket file it created
 * itself. Deleting somebody else's is not a tidy-up, it is an outage — a live
 * daemon whose name is unlinked keeps running on an unreachable inode, holding
 * credentials, serving nobody, while every caller sees "no daemon" and pays a
 * cold start forever.
 *
 * There is no POSIX "unlink this inode", so the check narrows the window
 * rather than closing it. What it removes is the LONG window (a probe, or ten
 * idle minutes) in which the file genuinely does change hands; what is left is
 * the microseconds between the stat and the unlink.
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
  // still leads to that same file afterwards.
  //
  // `isSocketAlive` can take up to a second (a connect, or its own timeout),
  // and a daemon starting concurrently can bind the path inside that window —
  // concurrent starts are not exotic, `recordMissAndDecideToSpawn` deletes the
  // hint file the moment it says yes, so several callers can each decide to
  // spawn at once. Unlinking by path alone would then delete a LIVE daemon's
  // socket on the strength of a probe that answered about a file which no
  // longer exists.
  const corpse = identifyFile(socketPath);
  if (corpse === null) return false;
  if (await isSocketAlive(socketPath)) return false;
  return unlinkIfSameFile(socketPath, corpse);
}

/**
 * The private path a daemon BINDS, before publishing the result under the
 * shared one. See `publishSocket` for why the shared path is never bound.
 *
 * Pid-scoped, so two daemons racing to start never bind the same file. The
 * `.sock` suffix is REPLACED rather than appended to, to keep the bound path
 * inside sockaddr_un.sun_path: `isSocketPathUsable` budgets 100 bytes against
 * a real limit of 103 (macOS) / 107 (Linux), and a pid is at most three bytes
 * longer than the `.sock` it stands in for — the allowance
 * `MAX_STAGING_OVERHEAD_BYTES` (identity.ts) holds every path budget to, so
 * that a shared path is only ever approved when this one fits as well.
 */
export function stagingSocketPath(socketPath: string, pid: number): string {
  const base = socketPath.endsWith(".sock") ? socketPath.slice(0, -".sock".length) : socketPath;
  return `${base}.${pid}`;
}

/**
 * Give a bound socket its shared name.
 *
 * `link` rather than `rename` because link is fail-CLOSED. If another daemon
 * won the race and published first, link throws EEXIST and this one loses
 * politely; a rename would silently unlink the winner and orphan a live,
 * credential-holding process on an inode no client can reach.
 *
 * Publishing at all — rather than binding the shared path directly — is what
 * keeps node from doing the same thing on our behalf: libuv unlinks the path
 * it bound when the handle closes, by path and unconditionally, so a daemon
 * binding the shared path deletes whatever is there when it shuts down, ten
 * idle minutes later, even if that is a successor's live socket. Binding a
 * private name puts THAT unlink somewhere harmless and leaves the shared name
 * under the control of `unlinkIfSameFile`.
 *
 * Hard links to a socket are POSIX and work on every filesystem the daemon is
 * supported on. Should some exotic one refuse, publishing falls back to an
 * atomic rename — but only onto a name nothing holds, because rename is
 * fail-OPEN and such a filesystem sends EVERY start down that branch. See the
 * note on the fallback below.
 */
export function publishSocket(stagingPath: string, socketPath: string): void {
  try {
    fs.linkSync(stagingPath, socketPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new DaemonAlreadyRunningError(socketPath);
    }

    // link() failed for a reason that is NOT "somebody got there first" — a
    // filesystem that will not hard-link a socket at all (EPERM/EOPNOTSUPP).
    // rename(2) is the only other atomic publish, and it REPLACES whatever
    // holds the target: precisely the fail-open behaviour link was chosen to
    // avoid. On such a filesystem every start lands here, so renaming
    // unconditionally would not merely lose a rare race — the fail-closed
    // property would be absent permanently, and silently.
    //
    // So: rename only onto a name nothing holds. `listen()` cleared this path
    // moments ago (cleanStaleSocket) and has been binding ever since, so an
    // occupant now is a daemon that published while we were starting. Refusing
    // costs this process its daemon and nothing else — `listen()` closes the
    // handle, libuv takes the staging file with it, and the caller runs the
    // command in-process. Renaming would cost the WINNER its reachability: a
    // live process holding resolved credentials on an inode no client can
    // dial, which `stop()`'s `unlinkIfSameFile` then (correctly) declines to
    // clean up, so it lingers for its full idle timeout.
    //
    // Reported as DaemonAlreadyRunningError, exactly as the branch above
    // reports the same situation whenever link CAN tell us about it.
    //
    // Between this check and the rename the usual microsecond window remains;
    // what it removes is the one that is open by construction.
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
   * The socket file THIS daemon published, recorded once it is listening. Every
   * later unlink is checked against it, so shutdown can never remove a
   * successor's socket — and a daemon that never got as far as publishing
   * (`null`) removes nothing at all.
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

    // Unlinking here (not just closing the server) is what makes the next
    // client see "no daemon" rather than a corpse it has to probe.
    //
    // Only while the path still leads to the file WE published, though. A
    // daemon lives for ten idle minutes and this one may have been orphaned
    // long ago — its name unlinked by a crash sweep and rebound by a successor
    // it knows nothing about. Unlinking by path there would kill a live daemon
    // on the way out, which is how "the daemon keeps disappearing" becomes
    // self-sustaining: every casualty takes its replacement with it.
    //
    // BEFORE `server.close()`, deliberately. (dev, ino) only identifies a file
    // while that inode is still referenced: drop the last reference and the
    // number is free for immediate reuse — Linux reuses it readily — so a
    // successor binding after our close could land on our old identity and be
    // deleted by this very guard. While the socket is still bound we hold a
    // reference, so the comparison cannot be fooled.
    try {
      unlinkIfSameFile(options.socketPath, publishedSocket);
    } catch {
      // Not "already gone" and not "we never published" — both of those return
      // false rather than throwing. What lands here is the residual class: a
      // filesystem refusal (EACCES, EPERM, a directory removed under us).
      // Shutdown proceeds regardless; a socket we could not unlink is a corpse
      // the next client's liveness probe cleans up.
    }
    server.close();

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
                reason: error instanceof Error ? error.message : "execution-failed",
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
    // The staging path is the one actually handed to bind(), so it is the one
    // that has to fit sockaddr_un.
    const stagingPath = stagingSocketPath(options.socketPath, process.pid);
    // Name the path that ACTUALLY failed. The staging path is the longer of the
    // two (a pid stands in for `.sock`), so it is the one that overflows first —
    // and reporting the shared path there printed a path the reader can measure
    // for themselves and find to be within the limit.
    const tooLong = !isSocketPathUsable(options.socketPath)
      ? options.socketPath
      : !isSocketPathUsable(stagingPath)
        ? stagingPath
        : null;
    if (tooLong !== null) {
      throw new Error(`socket path is too long for a unix domain socket: ${tooLong}`);
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
    // is in play at all. Reading it back off the shared path after publishing
    // looks equivalent and is not: anything that replaced that name in the gap
    // would be recorded as ours, and `stop()` would later delete a stranger's
    // live socket — the exact outage `unlinkIfSameFile` exists to prevent. The
    // staging path is a hard link to the very inode we bound (and, in the
    // rename fallback, becomes the shared name unchanged), so the identity is
    // knowable with certainty here and merely probable there.
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

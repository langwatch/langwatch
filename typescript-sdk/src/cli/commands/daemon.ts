/**
 * `langwatch daemon start|stop|status`
 *
 * The daemon normally manages itself — it is auto-spawned on first use and
 * self-exits when idle. These commands exist for the cases where you need to
 * see it, restart it, or make sure it is gone.
 */

import chalk from "chalk";

import {
  requestStatus,
  requestStop,
  type DaemonStatus,
} from "../daemon/client";
import {
  inspectSocketTrust,
  isDaemonSupported,
  resolveBuildId,
  resolveIdentity,
  UntrustedSocketDirError,
  type SocketTrustProblem,
} from "../daemon/identity";
import {
  cleanStaleSocket,
  createDaemonServer,
  DaemonAlreadyRunningError,
  DEFAULT_IDLE_TIMEOUT_MS,
} from "../daemon/server";
import { spawnDaemon } from "../daemon/spawn";
import { warmCommandModules } from "../daemon/warmup";
import { collectForwardedEnv } from "../daemon/eligibility";

declare const __CLI_VERSION__: string;

function resolveIdleTimeout(option?: string): number {
  if (option !== undefined) {
    const parsed = Number.parseInt(option, 10);
    if (Number.isNaN(parsed) || parsed <= 0) {
      throw new Error(`Invalid --idle-timeout: ${option}`);
    }
    return parsed;
  }
  const fromEnv = process.env.LANGWATCH_DAEMON_IDLE_MS;
  if (fromEnv) {
    const parsed = Number.parseInt(fromEnv, 10);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_IDLE_TIMEOUT_MS;
}

/**
 * The trust problems that mean "something is WRONG", as opposed to the two that
 * simply mean "no daemon is running here yet".
 *
 * `requestStatus`/`requestStop` collapse every problem into `null`/`false`,
 * which is right for them — an untrusted socket is exactly "no daemon" on the
 * hot path. It is wrong for these commands: the user explicitly asked about the
 * daemon, so silently reporting "not running" (or worse, "starting in the
 * background" for a daemon that will immediately die) hides the one fact they
 * need. `socket-missing` and `socket-dir-missing` are the ordinary empty state
 * and are deliberately NOT in here.
 */
function describeTrustProblem(
  problem: SocketTrustProblem,
): string | null {
  switch (problem) {
    case "socket-missing":
    case "socket-dir-missing":
      return null;
    case "socket-dir-not-a-directory":
      return "its socket directory is not a directory";
    case "socket-dir-foreign-owner":
      return "its socket directory is owned by another user";
    case "socket-dir-loose-mode":
      return "its socket directory is readable or writable by other users";
    case "socket-not-a-socket":
      return "another file is sitting at the socket path";
    case "socket-foreign-owner":
      return "the socket is owned by another user";
    case "socket-loose-mode":
      return "the socket is readable or writable by other users";
  }
}

/**
 * Print the blocking trust problem, if there is one. Returns true when the
 * caller must stop: a daemon whose socket cannot be trusted must not be
 * reported as running, started, or stopped.
 */
function reportUntrustedSocket(socketPath: string): boolean {
  const problem = inspectSocketTrust(socketPath);
  if (!problem) return false;
  const description = describeTrustProblem(problem);
  if (description === null) return false;

  console.error(
    chalk.red(`Refusing to use the langwatch daemon: ${description}.`),
  );
  console.error(chalk.gray(`  socket: ${socketPath}`));
  console.error(
    chalk.gray(
      "  Commands will keep working — they run in-process. Remove or fix the path above, " +
        "or point LANGWATCH_DAEMON_DIR at a directory you own, to use the daemon again.",
    ),
  );
  return true;
}

function requireSupport(): void {
  if (isDaemonSupported()) return;
  console.error(
    chalk.red(
      "The langwatch daemon is not available on this platform. Commands run in-process.",
    ),
  );
  process.exit(1);
}

export async function daemonStartCommand(options: {
  foreground?: boolean;
  idleTimeout?: string;
}): Promise<void> {
  requireSupport();

  const identity = resolveIdentity(process.env);
  const idleTimeoutMs = resolveIdleTimeout(options.idleTimeout);

  if (!options.foreground) {
    // Before anything else: `requestStatus` returns null for an untrusted
    // socket, so without this we would skip the "already running" branch,
    // spawn a child that dies on UntrustedSocketDirError, and cheerfully print
    // "Daemon starting in the background." No daemon would start, and every
    // later invocation would silently run in-process with no explanation.
    if (reportUntrustedSocket(identity.socketPath)) {
      process.exitCode = 1;
      return;
    }

    const existing = await requestStatus(identity.socketPath);
    if (existing) {
      console.log(
        chalk.gray(
          `Daemon already running (pid ${existing.pid}) at ${existing.socketPath}`,
        ),
      );
      return;
    }

    spawnDaemon({
      cliPath: process.argv[1] ?? "",
      env: collectForwardedEnv(process.env),
      identity,
      idleTimeoutMs,
    });
    console.log(chalk.green("Daemon starting in the background."));
    console.log(chalk.gray(`  socket: ${identity.socketPath}`));
    console.log(
      chalk.gray(`  idle timeout: ${Math.round(idleTimeoutMs / 1000)}s`),
    );
    return;
  }

  // Foreground: this process IS the daemon. Auto-spawn uses this path too.
  const server = createDaemonServer({
    socketPath: identity.socketPath,
    socketDir: identity.socketDir,
    fingerprint: identity.fingerprint,
    cliVersion: __CLI_VERSION__,
    build: resolveBuildId(__CLI_VERSION__, process.argv[1] ?? ""),
    idleTimeoutMs,
  });

  try {
    await server.listen();
  } catch (error) {
    if (error instanceof DaemonAlreadyRunningError) {
      // Two invocations raced to spawn one. Losing that race is a no-op.
      return;
    }
    if (error instanceof UntrustedSocketDirError) {
      // `ensureSocketDir` fails closed on a directory we cannot make private.
      // The error already carries the actionable sentence; a stack trace on top
      // of it would only bury the one line the user needs.
      console.error(chalk.red(error.message));
      console.error(
        chalk.gray(
          "  Commands still work — they run in-process. Point LANGWATCH_DAEMON_DIR " +
            "at a directory you own to use the daemon.",
        ),
      );
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  // Pay the module-load cost now, off the critical path of the first request.
  warmCommandModules();

  await server.closed();
}

export async function daemonStopCommand(): Promise<void> {
  requireSupport();

  const identity = resolveIdentity(process.env);

  // `requestStop` returns false for an untrusted socket, which would otherwise
  // surface as a flat "No daemon running." — and the user would have no idea
  // why their daemon keeps not existing.
  if (reportUntrustedSocket(identity.socketPath)) {
    process.exitCode = 1;
    return;
  }

  const stopped = await requestStop(identity.socketPath);

  if (stopped) {
    console.log(chalk.green("Daemon stopped."));
    return;
  }

  const cleaned = await cleanStaleSocket(identity.socketPath);
  console.log(
    chalk.gray(
      cleaned
        ? "No daemon running (removed a stale socket left by a crashed daemon)."
        : "No daemon running.",
    ),
  );
}

export async function daemonStatusCommand(options: {
  json?: boolean;
}): Promise<void> {
  const identity = resolveIdentity(process.env);
  const status: DaemonStatus | null = isDaemonSupported()
    ? await requestStatus(identity.socketPath)
    : null;

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          running: status !== null,
          supported: isDaemonSupported(),
          socketPath: identity.socketPath,
          ...(status ?? {}),
        },
        null,
        2,
      ),
    );
    return;
  }

  if (!isDaemonSupported()) {
    console.log(chalk.gray("Daemon: not supported on this platform."));
    return;
  }

  if (!status) {
    console.log(chalk.gray("Daemon: not running."));
    console.log(chalk.gray(`  socket: ${identity.socketPath}`));
    return;
  }

  console.log(chalk.green("Daemon: running"));
  console.log(chalk.gray(`  pid:          ${status.pid}`));
  console.log(chalk.gray(`  version:      ${status.cliVersion}`));
  console.log(chalk.gray(`  socket:       ${status.socketPath}`));
  console.log(
    chalk.gray(`  uptime:       ${Math.round(status.uptimeMs / 1000)}s`),
  );
  console.log(
    chalk.gray(
      `  idle timeout: ${Math.round(status.idleTimeoutMs / 1000)}s`,
    ),
  );
  console.log(chalk.gray(`  served:       ${status.served}`));
  console.log(chalk.gray(`  in flight:    ${status.inflight}`));
}

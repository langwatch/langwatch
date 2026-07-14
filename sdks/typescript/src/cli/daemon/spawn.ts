/**
 * Spawning a daemon without making anybody wait for it.
 */

import { spawn } from "node:child_process";
import * as os from "node:os";

import { identityEnv, type DaemonIdentity } from "./identity";

/**
 * Start a daemon in the background and return immediately.
 *
 * The command that triggered the spawn does NOT wait for it and does NOT try to
 * use it: it runs in-process, exactly as it would have anyway, and the daemon
 * is there for the NEXT invocation. Racing the spawn against in-process
 * execution would buy a few milliseconds on one command in exchange for two
 * code paths that can both be half-done when the process exits — not a trade
 * worth making for a cold start we are about to amortise away regardless.
 *
 * The child is detached with its stdio pointed at /dev/null, so it survives the
 * caller exiting and can never write into the caller's terminal.
 */
export function spawnDaemon({
  cliPath,
  env,
  identity,
  idleTimeoutMs,
}: {
  /** Path to the CLI's own entrypoint (`process.argv[1]`). */
  cliPath: string;
  /** The caller's forwarded env. */
  env: Record<string, string>;
  /** The identity the daemon must serve — the same one the caller resolved. */
  identity: DaemonIdentity;
  idleTimeoutMs?: number;
}): void {
  const args = [cliPath, "daemon", "start", "--foreground"];
  if (idleTimeoutMs !== undefined) {
    args.push("--idle-timeout", String(idleTimeoutMs));
  }

  try {
    const child = spawn(process.execPath, args, {
      detached: true,
      stdio: "ignore",
      // The daemon chdirs per request, so its own cwd only matters as a stable
      // baseline. The caller's cwd would be a poor choice: it can be deleted
      // out from under a daemon that outlives the command that spawned it.
      cwd: os.homedir(),
      env: {
        ...process.env,
        ...env,
        // Pinned last: the daemon boots in $HOME and runs dotenv, so a ~/.env
        // could otherwise hand it an endpoint or key the caller does not have —
        // and a daemon on a different socket than its client is a daemon nobody
        // ever talks to.
        ...identityEnv(env, identity),
        // Guard against a daemon recursively deciding it wants a daemon.
        LANGWATCH_NO_DAEMON: "1",
      },
    });
    child.unref();
  } catch {
    // A daemon we could not spawn is exactly as harmless as a daemon we never
    // tried to spawn: the command runs in-process either way.
  }
}

/**
 * Spawning a daemon without making anybody wait for it.
 */

import { spawn } from "node:child_process";
import * as os from "node:os";

import { identityEnv, type DaemonIdentity } from "./identity";

/**
 * The environment a spawned daemon may inherit from its spawner. The
 * daemon's boot env becomes the baseline every request resets to, so handing
 * it the spawner's full shell env would leak one project's variables into
 * every other caller's requests. It inherits only the identity triple, the
 * caller's already-filtered allowlisted overlay, and the vars listed below.
 */
const BASELINE_ENV_VARS = [
  "PATH",
  "HOME",
  "SHELL",
  "USER",
  "LOGNAME",
  "LANG",
  "TMPDIR",
  "TEMP",
  "TMP",
  "XDG_RUNTIME_DIR",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
] as const;

function baselineEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const baseline: Record<string, string> = {};
  for (const key of BASELINE_ENV_VARS) {
    const value = env[key];
    if (value !== undefined) baseline[key] = value;
  }
  // Locale categories (LC_CTYPE, LC_ALL, …): same rationale as LANG.
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith("LC_") && value !== undefined) baseline[key] = value;
  }
  return baseline;
}

/**
 * Starts a daemon in the background and returns immediately. The triggering
 * command runs in-process regardless; racing the spawn against it would only
 * shave a cold start we're about to amortise away, at the cost of two code
 * paths that can each be half-done on exit. Detached with stdio to
 * /dev/null, so it survives the caller exiting and never writes to its terminal.
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
        // A known-safe baseline only — see BASELINE_ENV_VARS above — NOT the
        // spawner's full shell env.
        ...baselineEnv(process.env),
        ...env,
        // Pinned last: the identity triple must survive anything the boot
        // could otherwise pick up — a daemon on a different socket than its
        // client is a daemon nobody ever talks to. (The daemon-server boot
        // also skips the dotenv load entirely; see index.ts.)
        ...identityEnv(env, identity),
        // Guard against a daemon recursively deciding it wants a daemon.
        LANGWATCH_NO_DAEMON: "1",
      },
    });
    // An async spawn failure (EAGAIN under fork pressure, a transient
    // resource limit) is delivered as an `error` event; with no listener node
    // raises it uncaught and kills the CALLER's CLI process. A daemon that
    // never started is exactly as harmless as one we never tried to start.
    child.on("error", () => undefined);
    child.unref();
  } catch {
    // A daemon we could not spawn is exactly as harmless as a daemon we never
    // tried to spawn: the command runs in-process either way.
  }
}

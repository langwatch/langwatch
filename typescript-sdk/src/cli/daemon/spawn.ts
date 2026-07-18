/**
 * Spawning a daemon without making anybody wait for it.
 */

import { spawn } from "node:child_process";
import * as os from "node:os";

import { identityEnv, type DaemonIdentity } from "./identity";

/**
 * The environment a spawned daemon is allowed to inherit from its spawner.
 *
 * The daemon's boot env becomes the BASELINE that every request resets to
 * (execution.ts applyWindow), so handing it the spawning project's full shell
 * env would leak one project's variables into every other caller's requests —
 * the exact cross-project contamination the per-request allowlist
 * (eligibility.ts collectForwardedEnv) exists to prevent. The daemon therefore
 * inherits only:
 *
 *   - the identity triple + LANGWATCH_NO_DAEMON, pinned below;
 *   - the caller's allowlisted overlay (the `env` argument, already filtered);
 *   - the process essentials a node child genuinely needs: PATH (for
 *     subprocesses commands spawn), HOME (config lookup; also the daemon's
 *     cwd), the login identity variables, locale (LANG/LC_*), temp dirs, and
 *     XDG_RUNTIME_DIR — socket placement MUST resolve identically on both
 *     sides or the client and daemon would look for the socket in different
 *     directories (identity.ts daemonSocketDir).
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

/**
 * Decides, from argv + env + tty alone (no command parsing, no module loads),
 * whether an invocation may be served by the daemon.
 *
 * Everything this module rejects runs in-process exactly as it does today.
 * When in doubt, reject: the daemon is an optimisation, and a wrong answer
 * here is a behaviour change, which is a bug.
 *
 * Kept dependency-free (node builtins only) — this runs on every single CLI
 * invocation, before anything else is loaded.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Commands that must never be served by a daemon.
 *
 * - daemon: would be self-referential.
 * - login/logout/config: they MUTATE the identity or the persisted config the
 *   daemon has already resolved and cached. Serving them from a warm process
 *   would leave that process holding stale (or newly-wrong) credentials.
 * - open/request-increase: they launch a browser. The child would inherit the
 *   daemon's environment and session, not the caller's.
 * - claude/codex/cursor/gemini/opencode: the gateway wrappers exec a real
 *   binary with inherited stdio and hand it the terminal for an entire
 *   interactive session. That is the caller's process's job, not an RPC's.
 * - init-shell: trivially cheap and its whole purpose is to be `eval`'d.
 */
const DENIED_COMMANDS = new Set([
  "daemon",
  "login",
  "logout",
  "config",
  "open",
  "request-increase",
  "claude",
  "codex",
  "cursor",
  "gemini",
  "opencode",
  "init-shell",
]);

/**
 * Flags that make a command unbounded in time. A `--follow` would pin one
 * daemon request open forever, holding the working-directory window (see
 * execution.ts) and defeating the idle timeout.
 */
const DENIED_FLAGS = new Set(["--follow", "--watch"]);

export type Ineligible =
  | "unsupported-platform"
  | "disabled-by-env"
  | "disabled-by-config"
  | "interactive-tty"
  | "denied-command"
  | "long-running-flag"
  | "no-command";

export type Eligibility =
  | { eligible: true }
  | { eligible: false; reason: Ineligible };

export interface EligibilityInput {
  /** process.argv.slice(2) */
  args: string[];
  env: NodeJS.ProcessEnv;
  /** `langwatch config set daemon off` was persisted (see isDaemonDisabledByConfig). */
  daemonDisabledByConfig?: boolean;
  /** process.stdout.isTTY */
  stdoutIsTty: boolean;
  /** process.stderr.isTTY */
  stderrIsTty: boolean;
  /** process.stdin.isTTY */
  stdinIsTty: boolean;
  platform: NodeJS.Platform;
}

/**
 * The TTY rule is what makes this whole feature safe.
 *
 * A daemon-served command runs inside a process whose stdio is /dev/null. It
 * therefore cannot render a live spinner, cannot read an interactive prompt,
 * and resolves `stream.isTTY` as false. Rather than emulate a terminal across
 * an RPC boundary (and get ora's frame timing, prompts' raw-mode reads and
 * chalk's colour detection subtly wrong), we simply never serve an invocation
 * that has a terminal attached.
 *
 * Humans therefore get today's behaviour, bit for bit. Agents and pipes — the
 * callers that actually issue N commands per turn and whose stdio is already
 * a pipe, so ora and chalk already behave in their degraded, non-TTY way —
 * get the daemon. The two cases can't diverge, because the daemon reproduces
 * exactly the non-TTY environment the caller already had.
 */
export function evaluateEligibility(input: EligibilityInput): Eligibility {
  if (input.platform === "win32") {
    return { eligible: false, reason: "unsupported-platform" };
  }

  const optOut = input.env.LANGWATCH_NO_DAEMON;
  if (optOut && optOut !== "0" && optOut !== "false") {
    return { eligible: false, reason: "disabled-by-env" };
  }

  if (input.daemonDisabledByConfig) {
    return { eligible: false, reason: "disabled-by-config" };
  }

  if (input.stdoutIsTty || input.stderrIsTty || input.stdinIsTty) {
    return { eligible: false, reason: "interactive-tty" };
  }

  const command = input.args.find((arg) => !arg.startsWith("-"));
  if (!command) {
    // Bare `langwatch`, or only flags (`--help`, `--version`). Cheap already,
    // and commander's help output is the one thing we gain nothing by warming.
    return { eligible: false, reason: "no-command" };
  }

  if (DENIED_COMMANDS.has(command)) {
    return { eligible: false, reason: "denied-command" };
  }

  if (input.args.some((arg) => DENIED_FLAGS.has(arg))) {
    return { eligible: false, reason: "long-running-flag" };
  }

  return { eligible: true };
}

/** Whether the client may auto-spawn a daemon it did not find. */
export function isAutoSpawnEnabled(env: NodeJS.ProcessEnv): boolean {
  const noSpawn = env.LANGWATCH_DAEMON_NO_SPAWN;
  return !(noSpawn && noSpawn !== "0" && noSpawn !== "false");
}

/**
 * Read the persistent opt-out (`langwatch config set daemon off`) straight
 * from config.json.
 *
 * Read directly rather than through utils/governance/config.ts: this module
 * must stay dependency-free — it runs on EVERY invocation, before anything
 * else is loaded, and `loadConfig` pulls in the governance module graph. The
 * field is owned by `GovernanceConfig.daemon`; keep the two in sync.
 */
export function isDaemonDisabledByConfig(env: NodeJS.ProcessEnv): boolean {
  try {
    const configFile =
      env.LANGWATCH_CLI_CONFIG ??
      path.join(os.homedir(), ".langwatch", "config.json");
    const parsed = JSON.parse(fs.readFileSync(configFile, "utf8")) as {
      daemon?: string;
    };
    return parsed.daemon === "off";
  } catch {
    // A missing config means "no opt-out recorded", and an unreadable or
    // corrupt one must not break a command HERE — `loadConfig` reports that
    // properly on any command that actually reads config.
    return false;
  }
}

/**
 * Environment forwarded to the daemon with each request.
 *
 * An allowlist, not the caller's whole environment: shipping every variable
 * would put unrelated secrets (AWS creds, tokens from the parent shell) into
 * the daemon's memory and into any future telemetry, for no benefit. Every
 * variable the CLI itself reads is `LANGWATCH_*`; the rest are the standard
 * output-shaping and proxy knobs.
 */
const ENV_ALLOWLIST = new Set([
  "NO_COLOR",
  "FORCE_COLOR",
  "CI",
  "DEBUG",
  "TERM",
  "COLORTERM",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  // Agent-mode detection (see cli/utils/output.ts AGENT_MODE_ENV_VARS): without
  // forwarding these, a daemon-served command could not tell it is being run
  // by an agent. `LANGWATCH_AGENT_MODE` rides the `LANGWATCH_` prefix rule.
  "CLAUDECODE",
  "CLAUDE_CODE",
  "CURSOR_AGENT",
  "GITHUB_COPILOT",
  "AMAZON_Q",
  "LW_AGENT_MODE",
]);

export function collectForwardedEnv(
  env: NodeJS.ProcessEnv,
): Record<string, string> {
  const forwarded: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (key.startsWith("LANGWATCH_") || ENV_ALLOWLIST.has(key)) {
      forwarded[key] = value;
    }
  }
  return forwarded;
}

/**
 * Reproduce the colour level the CALLER's process would have resolved, so the
 * daemon can set `chalk.level` to match and produce byte-identical output.
 *
 * Only the non-TTY branch of chalk's detection is needed: `evaluateEligibility`
 * has already guaranteed the caller has no terminal, and for a non-TTY stream
 * chalk emits nothing unless FORCE_COLOR says otherwise.
 */
export function resolveColorLevel(env: Record<string, string>): number {
  if ("NO_COLOR" in env && env.NO_COLOR !== "") return 0;

  const force = env.FORCE_COLOR;
  if (force === undefined) return 0;
  if (force === "false" || force === "0") return 0;
  if (force === "" || force === "true") return 1;

  const level = Number.parseInt(force, 10);
  if (Number.isNaN(level)) return 0;
  return Math.min(3, Math.max(0, level));
}

/**
 * Decides, from argv + env + tty alone, whether an invocation may be served
 * by the daemon. When in doubt, reject: a wrong answer here is a behaviour
 * change. Kept dependency-free — this runs on every CLI invocation.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Commands that must never be served by a daemon: mutating cached identity,
 * launching a session the caller's terminal must own, touching the
 * caller's filesystem, or reading stdin the daemon's `/dev/null` fd 0 can't.
 */
const DENIED_COMMANDS = new Set([
  "daemon",
  "login",
  "logout",
  "config",
  "open",
  "claude",
  "codex",
  "cursor",
  "gemini",
  "opencode",
  // interactive tool launchers: spawning them from the detached daemon
  // (stdio /dev/null, no DISPLAY) breaks them silently.
  "copilot",
  "code",
  "instrument",
  "report",
  "push",
]);

/**
 * Commands that must never be served, but whose NAME is too ordinary to
 * deny alone — every word must be present somewhere in the argument list
 * (denying bare `tag` would also deny `prompt pull --tag production`).
 */
const DENIED_COMMAND_PHRASES: readonly (readonly string[])[] = [
  ["tag", "delete"],
  // `agent dev` / `agent tunnel` run a tunnel session until Ctrl-C: they hold
  // signal handlers, a local proxy server and a child process, none of which
  // survive being served from the detached daemon. Denying the bare word
  // `agent` would take `agent list` with it, so the phrases are matched.
  ["agent", "dev"],
  ["agent", "tunnel"],
  // `ingest context` reads the CALLER's identity out of its environment
  // (CLAUDE_CODE_SESSION_ID, TRACEPARENT, CODEX_HOME) — none of which the
  // forwarded-env allowlist carries, so a daemon-served run would resolve
  // the wrong session or none. `ingest guidance` is a claude hook whose
  // stdout is injected into the session; same caller-owned contract.
  ["ingest", "context"],
  ["ingest", "guidance"],
];

/**
 * Flags that make a command unbounded in time. `--follow` would pin a
 * daemon request open forever; `--wait` polls past the client's 25s daemon
 * timeout (client.ts), so a daemon-served run exits 124 while still going.
 */
const DENIED_FLAGS = new Set(["--follow", "--watch", "--wait"]);

/**
 * Flags that make the CALLER's standard input part of the command's input.
 * The daemon cannot reproduce fd 0 (spawned with `stdio: "ignore"`), so a
 * daemon-served `--stdin` command reads immediate EOF.
 */
const STDIN_FLAGS = new Set(["--stdin"]);

export type Ineligible =
  | "unsupported-platform"
  | "disabled-by-env"
  | "disabled-by-config"
  | "interactive-tty"
  | "piped-stdin"
  | "reads-stdin"
  | "denied-command"
  | "long-running-flag"
  | "no-command";

export type Eligibility = { eligible: true } | { eligible: false; reason: Ineligible };

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
  /**
   * The caller's fd 0 holds data a command could read (pipe/file/socket).
   * See `stdinCarriesData`, how dispatch.ts resolves it.
   */
  stdinCarriesData: boolean;
  platform: NodeJS.Platform;
}

/**
 * A daemon-served command's stdio is /dev/null: a TTY-attached invocation
 * is refused, and so is any invocation that would read stdin (fd 0 carries
 * the caller's DATA, which the daemon can never reproduce).
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

  // A separate fact from the TTY check, and a separate reason: this caller has
  // no terminal at all, which is precisely why it looked servable.
  if (input.stdinCarriesData) {
    return { eligible: false, reason: "piped-stdin" };
  }

  // Checked over every argument, not just the first operand: the root
  // program's value-bearing global options parse ahead of the subcommand,
  // so the first operand is not reliably the command. Over-rejecting is the
  // correct direction to be wrong in.
  if (input.args.some((arg) => DENIED_COMMANDS.has(arg))) {
    return { eligible: false, reason: "denied-command" };
  }

  if (DENIED_COMMAND_PHRASES.some((phrase) => phrase.every((word) => input.args.includes(word)))) {
    return { eligible: false, reason: "denied-command" };
  }

  // `--wait=90` carries its value in the same token, so the flag is read up
  // to the equals sign.
  if (input.args.some((arg) => DENIED_FLAGS.has(arg.split("=")[0] ?? arg))) {
    return { eligible: false, reason: "long-running-flag" };
  }

  if (input.args.some((arg) => STDIN_FLAGS.has(arg))) {
    return { eligible: false, reason: "reads-stdin" };
  }

  if (!hasCommandOperand(input.args)) {
    // Bare `langwatch`, only flags (`--help`, `--version`), or nothing but a
    // global option and its value. Cheap already, and commander's help output
    // is the one thing we gain nothing by warming.
    return { eligible: false, reason: "no-command" };
  }

  return { eligible: true };
}

/**
 * Could any of these arguments actually BE a command? Which options take a
 * value can't be looked up here (dependency-free), so any `-x` is assumed
 * to, over-rejecting a one-word command behind a boolean flag.
 */
function hasCommandOperand(args: string[]): boolean {
  return args.some((arg, index) => {
    if (arg.startsWith("-")) return false;
    const previous = index === 0 ? undefined : args[index - 1];
    return previous === undefined || !previous.startsWith("-") || previous.includes("=");
  });
}

/**
 * Does this descriptor carry data a command could actually READ? `isTTY`
 * can't tell, since it also covers pipes and files. `fstat(0)`, not
 * `process.stdin`, to avoid instantiating the read stream.
 */
export function stdinCarriesData(fd = 0): boolean {
  try {
    const stat = fs.fstatSync(fd);
    return stat.isFIFO() || stat.isFile() || stat.isSocket();
  } catch {
    return false;
  }
}

/** Whether the client may auto-spawn a daemon it did not find. */
export function isAutoSpawnEnabled(env: NodeJS.ProcessEnv): boolean {
  const noSpawn = env.LANGWATCH_DAEMON_NO_SPAWN;
  return !(noSpawn && noSpawn !== "0" && noSpawn !== "false");
}

/**
 * Read the persistent opt-out straight from config.json rather than through
 * utils/governance/config.ts: this module must stay dependency-free. Owned
 * by `GovernanceConfig.daemon`; keep the two in sync.
 */
export function isDaemonDisabledByConfig(env: NodeJS.ProcessEnv): boolean {
  try {
    const configFile =
      env.LANGWATCH_CLI_CONFIG ?? path.join(os.homedir(), ".langwatch", "config.json");
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
 * Environment forwarded to the daemon with each request: an allowlist, not
 * the caller's whole environment, so unrelated secrets never reach the
 * daemon's memory or future telemetry.
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

export function collectForwardedEnv(env: NodeJS.ProcessEnv): Record<string, string> {
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
 * Reproduce the colour level the CALLER's process would resolve, for
 * byte-identical output. Only the non-TTY branch is needed here.
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

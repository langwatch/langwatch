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
 * - open: it launches a browser. The child would inherit the daemon's
 *   environment and session, not the caller's.
 * - claude/codex/cursor/gemini/opencode: the gateway wrappers exec a real
 *   binary with inherited stdio and hand it the terminal for an entire
 *   interactive session. That is the caller's process's job, not an RPC's.
 * - instrument: it prompts and rewrites credential wiring on the caller's
 *   machine; identity and fs side effects belong to the caller's process.
 * - report: a one-shot, network-bound support command, often a customer's
 *   very first `npx langwatch` contact. Leaving a resident daemon behind as
 *   a side effect of filing an issue report would be surprising, and the
 *   cold-start saving is irrelevant next to the upload.
 * - push: resolves a prompt conflict with a `readline` question on stdin. The
 *   daemon's fd 0 is /dev/null (spawn.ts spawns it with `stdio: "ignore"`), so
 *   `rl.question` never gets an answer, the promise never settles, and the
 *   request hangs to the ten-minute request timeout. See DENIED_COMMAND_PHRASES
 *   for the other prompting command.
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
 * Commands that must never be served, but whose NAME is too ordinary to deny on
 * its own. Every word must be present somewhere in the argument list.
 *
 * `prompt tag delete` prompts on stdin exactly as `push` does (commands/tag/
 * delete.ts), and hangs the same way. Denying the bare word `tag` would take
 * `prompt pull --tag production` with it — a common, perfectly servable
 * invocation — so the phrase is matched instead. Position-agnostic like every
 * other rule here: a tag literally named `delete` is denied too, which costs
 * one cold start.
 */
const DENIED_COMMAND_PHRASES: readonly (readonly string[])[] = [
  ["tag", "delete"],
  // `agent dev` / `agent tunnel` run a tunnel session until Ctrl-C: they hold
  // signal handlers, a local proxy server and a child process, none of which
  // survive being served from the detached daemon. Denying the bare word
  // `agent` would take `agent list` with it, so the phrases are matched.
  ["agent", "dev"],
  ["agent", "tunnel"],
];

/**
 * Flags that make a command unbounded in time. A `--follow` would pin one
 * daemon request open forever, holding the working-directory window (see
 * execution.ts) and defeating the idle timeout.
 */
const DENIED_FLAGS = new Set(["--follow", "--watch"]);

/**
 * Flags that make the CALLER's standard input part of the command's input.
 *
 * The daemon cannot reproduce fd 0: it is spawned detached with
 * `stdio: "ignore"` (spawn.ts), so its standard input is /dev/null. Served in
 * that process, `dataset records add <ds> --stdin` reads "" on immediate EOF
 * and dies with `Invalid JSON: could not parse input.` — while the identical
 * command run in-process adds the records. The SECOND such request is worse
 * still: `process.stdin` has already emitted `end`, so nothing ever fires again
 * and the request hangs to its ten-minute timeout.
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
  /**
   * The caller's fd 0 holds data a command could read — a pipe, a redirected
   * file or a socket, as opposed to /dev/null, a terminal or a closed
   * descriptor. See `stdinCarriesData`, which is how dispatch.ts resolves it.
   */
  stdinCarriesData: boolean;
  platform: NodeJS.Platform;
}

/**
 * The stdio rules are what make this whole feature safe.
 *
 * A daemon-served command runs inside a process whose stdio is /dev/null. It
 * therefore cannot render a live spinner, cannot read an interactive prompt,
 * and resolves `stream.isTTY` as false. Rather than emulate a terminal across
 * an RPC boundary (and get ora's frame timing, prompts' raw-mode reads and
 * chalk's colour detection subtly wrong), we simply never serve an invocation
 * that has a terminal attached.
 *
 * Humans therefore get today's behaviour, bit for bit. Agents and pipes — the
 * callers that actually issue N commands per turn and whose OUTPUT is already
 * a pipe, so ora and chalk already behave in their degraded, non-TTY way —
 * get the daemon. The two cases can't diverge, because the daemon reproduces
 * exactly the non-TTY environment the caller already had.
 *
 * INPUT is the half a terminal check does not cover, and the direction the rule
 * has to be read in is the opposite one. `cat records.json | langwatch …` has no
 * TTY anywhere, so it looked like the ideal daemon caller — while being the one
 * shape the daemon can least reproduce, because fd 0 is the only stdio stream
 * that carries the caller's DATA rather than merely its destination. The daemon
 * is spawned with `stdio: "ignore"`, and there is no way to hand it a descriptor
 * a client opened, so any invocation that will read stdin is ineligible: by the
 * shape of fd 0 (`piped-stdin`), by a flag that says so (`reads-stdin`), or by
 * the name of a command that prompts (`denied-command`).
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

  // The denied names and flags are checked BEFORE asking whether there is a
  // command at all: they are facts about the argument list that hold wherever
  // the word sits, so checking them first keeps the sharper reason — and keeps
  // `--verbose login` reading as `denied-command` rather than as an argument
  // list we could not find a command in.
  //
  // Every argument is checked, not just the first operand — because the first
  // operand is NOT reliably the command.
  //
  // The root program takes value-bearing global options (`-o <format>`,
  // `--json <fields>`, `--jq <expr>`; see registerOutputOptions) and enables
  // positional options, so those parse BEFORE the subcommand and their VALUE
  // is the first thing here that does not start with `-`. Under the old
  // first-operand rule `langwatch -o json open /traces` therefore read as the
  // command `json`, sailed through this gate, and ran `open` inside a daemon
  // that is detached with stdio `/dev/null` and carries none of the caller's
  // display or session environment — so no browser ever opened. `-o json
  // claude -p '…'` was worse still: the wrapper ran with its output going to
  // /dev/null, and the caller got nothing back.
  //
  // Skipping the known value-taking globals instead would fix today's argv and
  // rot on tomorrow's: this module is deliberately dependency-free (it runs on
  // every invocation, before anything else loads), so it cannot consult the
  // program's real option table, and a hand-copied list silently reopens the
  // hole the moment a global option is added. Scanning every argument depends
  // on neither argument position nor that table, so there is nothing to keep
  // in sync and no ordering trick to bypass it.
  //
  // It over-rejects — `langwatch prompt get open` is not the `open` command —
  // and that is the correct direction to be wrong in: a needless rejection
  // costs one cold start, while a wrong acceptance is a behaviour change.
  if (input.args.some((arg) => DENIED_COMMANDS.has(arg))) {
    return { eligible: false, reason: "denied-command" };
  }

  if (
    DENIED_COMMAND_PHRASES.some((phrase) =>
      phrase.every((word) => input.args.includes(word)),
    )
  ) {
    return { eligible: false, reason: "denied-command" };
  }

  if (input.args.some((arg) => DENIED_FLAGS.has(arg))) {
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
 * Could any of these arguments actually BE a command?
 *
 * An operand is not a command when the option in front of it is eating it. The
 * root program's value-taking globals (`-o <format>`, `--json <fields>`,
 * `--jq <expr>`) parse ahead of the subcommand, so `langwatch -o json` carries
 * no command at all — `json` is a format. Under a plain "is there a bare word?"
 * rule that invocation sailed through as eligible and commander rendered the
 * ROOT HELP inside the daemon — a round trip bought for a caller whose entire
 * invocation was a help request, where there is nothing to warm at all.
 *
 * (Which bin NAME that help is titled with is no longer this rule's business:
 * the two bins share one daemon — `resolveBuildId` stats the same symlink
 * target for both — so the caller's `argv[1]` rides the `exec` frame and
 * `buildProgram({ bin })` titles the help with it. Rejecting here is about
 * cost, not correctness.)
 *
 * Which options take a value is exactly what this module cannot look up — it
 * is dependency-free by design and cannot consult the program's option table,
 * and a hand-copied list rots (see the note above). So it assumes any `-x`
 * might take one, and treats only `-x=value`, which carries its own, as
 * certainly not. That over-rejects a one-word command behind a boolean flag
 * (`langwatch --agent status`) for the price of one cold start, and never lets
 * a commandless invocation through. Anything longer is unaffected:
 * in `--agent trace list`, `list` follows an operand rather than a flag.
 */
function hasCommandOperand(args: string[]): boolean {
  return args.some((arg, index) => {
    if (arg.startsWith("-")) return false;
    const previous = index === 0 ? undefined : args[index - 1];
    return (
      previous === undefined ||
      !previous.startsWith("-") ||
      previous.includes("=")
    );
  });
}

/**
 * Does this descriptor carry data a command could actually READ?
 *
 * `isTTY` cannot answer this. It distinguishes a terminal from everything else,
 * and everything else covers both the shape the daemon reproduces perfectly
 * (/dev/null, or a closed descriptor — nothing to read, EOF immediately) and
 * the shape it cannot reproduce at all (a pipe, a `< file` redirect, a socket —
 * bytes that exist only in the CALLER's process). `fstat` tells the two apart:
 * the first pair are character devices or plain errors, the second are FIFOs,
 * regular files and sockets.
 *
 * `fstat(0)` rather than `process.stdin`: touching `process.stdin` instantiates
 * the read stream, and this runs on every single invocation, before anything
 * else is loaded.
 *
 * Anything we cannot stat is treated as carrying nothing — the daemon path is
 * an optimisation, and the failure mode of guessing "no" here is one served
 * command that had nothing to read anyway.
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

/**
 * Persist the langwatch export block to the user's shell rc file
 * (~/.zshrc / ~/.bashrc / ~/.config/fish/config.fish) so a new
 * shell auto-picks up the gateway + OTLP env vars without running
 * `langwatch <tool>` as a wrapper.
 *
 * Spec for bug-bash item 1:
 *   1.2 - after login, OFFER to persist the export block. Y/n/never.
 *   1.3 - Remember choice. Stay quiet inside an already-configured
 *         shell (env already has the gateway vars set).
 *
 * Design notes:
 *   - The block is bracketed with marker comments so a second
 *     persist run is idempotent (regex replace, no duplicate
 *     blocks).
 *   - "never" persists `shell_rc_preference: "skip"` on the config
 *     so future logins on this machine stay quiet.
 *   - "not now" (n) does NOT persist - the next login re-asks. The
 *     in-shell quietness comes from the already-configured detect.
 *   - Detect "already configured" by checking process.env for both
 *     ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN. If either is
 *     present, assume the user already wired it up (via the rc
 *     file or by sourcing the export manually) and skip the
 *     prompt silently.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline";

import chalk from "chalk";

import {
  type CodexNotifyWriteResult,
  codexNotifyCommandIsEphemeral,
  defaultCodexNotifyCommand,
  writeCodexNotifyBlock,
} from "../codex-config-toml";
import { appEnvHasAllVars, appSettingsTargetFor, installAppEnv } from "./app-settings";
import { ensureLangwatchClaudePlugin, readClaudePluginState } from "./claude-plugin";
import {
  installSessionContextHooks,
  removeSessionContextHooks,
} from "./session-context-hooks";
import { type GovernanceConfig, saveConfig } from "./config";

/**
 * Tools whose Path B telemetry persists as a scoped shell function (no
 * config-file env target). Drives BOTH the logout target scan
 * (telemetry-targets.ts) and the gateway spawn's `unset -f`
 * (wrapper.ts) — a persisted rc function re-injects the OTel env at
 * invocation time, AFTER the wrapper's exports, so gateway runs must
 * remove the function from the shell session (never from the rc file)
 * or the same calls get captured twice.
 */
export const SHELL_FUNCTION_TOOLS: readonly string[] = [
  "gemini",
  "opencode",
  "copilot",
  // `code` (VS Code Copilot Chat) is a CLI-launched editor with no
  // config-file env target for the auth header, so it uses the same
  // scoped-function tier. ADR-039 §Extension #2.
  "code",
] as const;

const BLOCK_BEGIN = "# >>> langwatch begin >>>";
const BLOCK_END = "# <<< langwatch end <<<";

/**
 * Markers for the legacy global gateway export block. Nothing writes this
 * block anymore; logout still knows the markers so it can clean up blocks
 * written by older CLI versions.
 */
export const GATEWAY_RC_MARKERS = { begin: BLOCK_BEGIN, end: BLOCK_END };

/**
 * Per-tool marker pair for a scoped wrapper function. Tools without a
 * config-file env target (gemini, opencode, …) get a shell function that
 * sets the telemetry env ONLY for `<tool>` invocations, instead of a global
 * `export` that leaks into every shell child. Each tool gets its own marker
 * pair so multiple wrappers coexist in one rc file.
 */
export function toolMarkers(tool: string): { begin: string; end: string } {
  return {
    begin: `# >>> langwatch ${tool} begin >>>`,
    end: `# <<< langwatch ${tool} end <<<`,
  };
}

export type DetectedShell = "zsh" | "bash" | "fish";

/**
 * Best-effort shell detection from $SHELL. Falls back to zsh on
 * macOS (default since Catalina) and bash on Linux. Returns null
 * when running under an unsupported shell (cmd, powershell, etc.)
 * - the persist flow skips entirely in that case.
 */
export function detectShell(): DetectedShell | null {
  const raw = (process.env.SHELL ?? "").toLowerCase();
  if (raw.includes("fish")) return "fish";
  if (raw.includes("zsh")) return "zsh";
  if (raw.includes("bash")) return "bash";
  if (process.platform === "darwin") return "zsh";
  if (process.platform === "linux") return "bash";
  return null;
}

/** Render an absolute path with the home dir collapsed to `~`. */
export function tildify(p: string): string {
  const home = os.homedir();
  return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

/** Returns the absolute path of the shell rc file. */
export function rcPath(shell: DetectedShell): string {
  const home = os.homedir();
  switch (shell) {
    case "zsh":
      return path.join(home, ".zshrc");
    case "bash":
      return path.join(home, ".bashrc");
    case "fish":
      return path.join(home, ".config", "fish", "config.fish");
  }
}

/**
 * Whether the current shell already has the gateway env vars
 * exported. If true the persist prompt stays quiet (per 1.3).
 */
export function isShellAlreadyConfigured(): boolean {
  return !!process.env.ANTHROPIC_BASE_URL && !!process.env.ANTHROPIC_AUTH_TOKEN;
}

/**
 * Whether the shell rc file already has a langwatch marker block carrying
 * THIS export set. Lets the persist offer stay quiet when the user has
 * already installed the current exports but hasn't sourced the rc in this
 * shell yet (so the env isn't live in process.env). Checks the file on
 * disk, not just the environment.
 *
 * `requiredKeys` makes the match export-set aware: a bare marker block, or
 * a block for a DIFFERENT export set (e.g. a stale block missing the OTLP
 * vars this run needs), does NOT count as installed, so the offer still
 * fires and persists the current vars. Omit `requiredKeys` to test only
 * for the presence of a well-formed block.
 */
export function rcHasLangwatchBlock({
  shell,
  requiredKeys,
  markers = { begin: BLOCK_BEGIN, end: BLOCK_END },
}: {
  shell: DetectedShell;
  requiredKeys?: string[];
  markers?: { begin: string; end: string };
}): boolean {
  try {
    const content = fs.readFileSync(rcPath(shell), "utf8");
    const begin = content.indexOf(markers.begin);
    const end = content.indexOf(markers.end);
    if (begin === -1 || end === -1 || end < begin) return false;
    if (!requiredKeys || requiredKeys.length === 0) return true;
    const block = content.slice(begin, end);
    return requiredKeys.every((k) => block.includes(k));
  } catch {
    return false;
  }
}

function quote(s: string): string {
  if (!/[ \t\n'"$\\]/.test(s)) return s;
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/**
 * Build a shell function that wraps `<tool>` so the OTEL telemetry env is
 * set ONLY for `<tool>` invocations, not exported into every shell child.
 * This is the fallback for any tool with no config-file env target (gemini,
 * opencode, …): `command <tool>` inside the function bypasses the function
 * itself (no recursion) and runs the real binary.
 *
 * posix (zsh/bash) uses a function with an env-prefix; fish uses a function
 * with block-local `set -lx`. The body (no begin/end markers) is returned
 * for `persistBlockToRc` to bracket with the tool's markers.
 */
export function buildScopedToolFunction(
  tool: string,
  vars: Record<string, string>,
  shell: DetectedShell,
): string {
  const entries = Object.entries(vars);
  if (shell === "fish") {
    const sets = entries.map(([k, v]) => `    set -lx ${k} ${quote(v)}`).join("\n");
    return [`function ${tool}`, sets, `    command ${tool} $argv`, "end"].join("\n");
  }
  const assigns = entries.map(([k, v]) => `    ${k}=${quote(v)} \\`).join("\n");
  return [`${tool}() {`, assigns, `    command ${tool} "$@"`, "}"].join("\n");
}

/**
 * Append (or replace, if the marker block already exists) the
 * export block to the shell rc file. Creates the file if missing.
 * Idempotent: a second run replaces the block in place rather
 * than duplicating it.
 *
 * Returns the path that was written for the caller to surface.
 */
export function persistBlockToRc(
  shell: DetectedShell,
  block: string,
  markers: { begin: string; end: string } = {
    begin: BLOCK_BEGIN,
    end: BLOCK_END,
  },
): string {
  const file = rcPath(shell);
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const wrapped = `${markers.begin}\n${block}\n${markers.end}\n`;

  let existing = "";
  try {
    existing = fs.readFileSync(file, "utf8");
  } catch {
    // ENOENT - fresh file
  }

  const marker = new RegExp(
    `${escapeRegex(markers.begin)}[\\s\\S]*?${escapeRegex(markers.end)}\\n?`,
    "m",
  );
  let next: string;
  if (marker.test(existing)) {
    next = existing.replace(marker, wrapped);
  } else {
    const needsNewline = existing.length > 0 && !existing.endsWith("\n");
    next = existing + (needsNewline ? "\n" : "") + "\n" + wrapped;
  }
  fs.writeFileSync(file, next);
  return file;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Remove a marker-bracketed langwatch block from the shell rc file, if
 * present. Removes at most one leading + one trailing newline around the
 * block, so the blank line the install path inserts before it goes with it
 * while unrelated user whitespace is left alone. Returns true when a block
 * was removed (idempotent — false when the file or the block was absent).
 */
export function removeBlockFromRc(
  shell: DetectedShell,
  markers: { begin: string; end: string } = {
    begin: BLOCK_BEGIN,
    end: BLOCK_END,
  },
): boolean {
  const file = rcPath(shell);
  let content: string;
  try {
    content = fs.readFileSync(file, "utf8");
  } catch {
    return false; // ENOENT
  }
  const re = new RegExp(
    `\\n?${escapeRegex(markers.begin)}[\\s\\S]*?${escapeRegex(markers.end)}\\n?`,
    "m",
  );
  if (!re.test(content)) return false;
  fs.writeFileSync(file, content.replace(re, ""));
  return true;
}

/**
 * Y/n/never prompt for stdin. Returns:
 *   - "yes" → append the block now
 *   - "no" → skip this login, re-ask next time
 *   - "never" → set shell_rc_preference=skip so we stay quiet forever
 *   - "skip" → non-TTY / closed stdin; do nothing
 */
export type PersistChoice = "yes" | "no" | "never" | "skip";

/**
 * `question` replaces the default wording for a tool whose "yes" buys more than
 * an env block. Whatever it says has to be said BEFORE the answer, because a
 * bare Enter is a yes, so it is part of the question rather than a line printed
 * around it.
 */
export async function askPersistChoice({
  target,
  tool,
  question,
}: {
  target: string;
  tool: string;
  question?: string;
}): Promise<PersistChoice> {
  if (!process.stdin.isTTY) return "skip";

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const asked = question ?? persistQuestion({ tool, targetHint: target });
  const ans = await new Promise<string>((resolve) => {
    rl.question(`${asked} [Y/n/never] `, (a) => resolve(a));
  });
  rl.close();

  const norm = ans.trim().toLowerCase();
  if (norm === "" || norm === "y" || norm === "yes") return "yes";
  if (norm === "never") return "never";
  return "no";
}

/**
 * What the persist offer asks. Claude gets its own sentence because saying yes
 * to it does two things rather than one: it saves the env block AND installs the
 * plugin that reports session context. Consent has to name both, and name what
 * the plugin's hooks record, or the user is agreeing to something they were
 * never told about.
 */
function persistQuestion({
  tool,
  targetHint,
}: {
  tool: string;
  targetHint: string;
}): string {
  if (tool === "claude") {
    return (
      `Set up LangWatch capture for ${tool}? This saves the telemetry env vars to ` +
      `${targetHint} and installs the LangWatch Claude Code plugin, whose session ` +
      `hooks record the repository and branch each session works on.`
    );
  }
  return `Install env vars to ${targetHint} so that next time the plain \`${tool}\` command keeps capturing telemetry data?`;
}

/**
 * Ingestion-mode (Path B) persist offer. Called by the
 * `langwatch <tool>` wrapper AFTER it resolves to ingestion mode,
 * so the user can install the tool's OTLP telemetry exports into
 * whatever the target for `<tool>` is. Once persisted, a plain
 * `<tool>` invocation (without the `langwatch` wrapper) inherits
 * the OTEL_EXPORTER_OTLP_* env and captures automatically - which
 * is the whole point of "installing" the telemetry.
 *
 * The target depends on the tool:
 *   - `claude` writes to `~/.claude/settings.json`'s `env` block
 *     — Claude Code loads that on every invocation, so the vars
 *     stay scoped to `claude` runs and don't leak into every
 *     other shell child.
 *   - Every other supported wrapper (codex, cursor, gemini,
 *     opencode) falls back to the detected shell rc file.
 *
 * Persists the exact OTEL env the wrapper just computed for this
 * run (`vars`), not the gateway block. Y / n / never, same
 * `shell_rc_preference=skip` opt-out. Stays quiet when the target
 * already carries the current export set.
 */
export async function maybeOfferIngestionShellRcPersist({
  cfg,
  tool,
  vars,
}: {
  cfg: GovernanceConfig;
  tool: string;
  vars: Record<string, string>;
}): Promise<void> {
  if (cfg.shell_rc_preference === "skip") return;
  // Already wired up - the OTLP exporter env is present in this shell.
  if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return;
  if (Object.keys(vars).length === 0) return;

  const appTarget = appSettingsTargetFor(tool);
  if (appTarget) {
    if (appEnvHasAllVars(appTarget, vars)) {
      // The exports are current, but the session context seam may not be: it
      // arrived after the env block, so a device that persisted earlier
      // carries the block and none of it. Same file, same grant, so assert it
      // here rather than leaving repository identity off every session that
      // already said yes.
      reassertClaudeSessionContext(tool);
      return;
    }
    console.log();
    const choice = await askPersistChoice({
      target: appTarget.displayPath,
      tool,
    });
    if (choice === "skip" || choice === "no") return;
    if (choice === "never") {
      recordNeverChoice(cfg);
      return;
    }
    try {
      installAppEnv(appTarget, vars);
      console.log(
        chalk.green(
          `  ✓ Installed langwatch telemetry exports to ${appTarget.displayPath}`,
        ),
      );
      installClaudeSessionContext(tool);
    } catch (err) {
      console.log(
        chalk.yellow(
          `  ! Couldn't write to ${appTarget.displayPath}: ${(err as Error).message}`,
        ),
      );
    }
    return;
  }

  // codex needs no prompt here: the wrapper's per-run [otel] write
  // persists the Authorization header inline in ~/.codex/config.toml
  // (0600, marker-managed, removed by `langwatch logout`), so a plain
  // `codex` already captures. What can still be missing on an older
  // install is the turn harvest, the notify hook that recovers the
  // conversation content those exports carry none of. Assert it under
  // the same grant.
  if (tool === "codex") {
    assertCodexTurnHarvest();
    return;
  }

  const shell = detectShell();
  if (!shell) return;

  // Every remaining tool (gemini, opencode, …) has no config-file env target
  // and rides on generic OTEL_* names, so a global `export` would leak into
  // every shell child. Install a scoped wrapper function that sets the
  // telemetry env only for `<tool>` runs, under the tool's own marker pair so
  // multiple wrappers coexist. (cursor never reaches here — it's gateway-only
  // via allow_otel_direct=false, so Path B ingestion never resolves for it.)
  const markers = toolMarkers(tool);
  // Already installed for this endpoint, even if this shell hasn't sourced the
  // rc yet (so the OTEL env isn't in process.env). Keyed on the endpoint so a
  // stale wrapper for a different endpoint doesn't suppress installing this one.
  if (
    rcHasLangwatchBlock({
      shell,
      requiredKeys: [vars.OTEL_EXPORTER_OTLP_ENDPOINT].filter(Boolean) as string[],
      markers,
    })
  ) {
    return;
  }
  const target = rcPath(shell);
  console.log();
  const choice = await askPersistChoice({ target, tool });
  if (choice === "skip" || choice === "no") return;
  if (choice === "never") {
    recordNeverChoice(cfg);
    return;
  }
  try {
    const wrote = persistBlockToRc(
      shell,
      buildScopedToolFunction(tool, vars, shell),
      markers,
    );
    console.log(
      chalk.green(`  ✓ Installed a scoped \`${tool}\` telemetry wrapper in ${wrote}`),
    );
  } catch (err) {
    console.log(
      chalk.yellow(`  ! Couldn't write to ${target}: ${(err as Error).message}`),
    );
  }
}

/**
 * What asking codex to run the turn harvest left behind.
 *
 * `blocked` is an outcome rather than a thrown error because it is the one
 * failure the user can fix, and every caller wants to say so and carry on
 * rather than abandon an install that otherwise worked.
 */
export type CodexTurnHarvestOutcome =
  | { status: "installed"; chained: string[] | null; ephemeral: boolean }
  | { status: "unchanged" }
  | { status: "skipped" }
  | { status: "blocked" };

/** What every caller says when the merge was refused. */
export const CODEX_TURN_HARVEST_BLOCKED_MESSAGE =
  "Your codex configuration already runs a program of its own after every turn, and it cannot be moved safely, so the conversation will not be recorded. Remove that setting and run this again.";

/**
 * The merge refuses rather than leave two top-level `notify` keys behind, which
 * would stop codex from starting at all. It travels as a message because it is
 * raised where the TOML is read, one module below this one.
 */
function isNotifyMergeRefusal(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith("refusing to write ");
}

/**
 * Ask codex to run the turn harvest after every completed turn. Idempotent.
 *
 * Codex's telemetry export carries tokens, model and timing but no
 * conversation: the reply is dropped before export and no codex setting brings
 * it back. What codex does offer is `notify`, a program it runs after every
 * completed turn. Pointed at our own harvest, that is what turns a plain
 * `codex` into traces with something to read.
 */
export function installCodexTurnHarvest(
  options: { filePath?: string } = {},
): CodexTurnHarvestOutcome {
  const command = defaultCodexNotifyCommand();
  if (!command) return { status: "skipped" };
  let result: CodexNotifyWriteResult;
  try {
    result = writeCodexNotifyBlock({ command }, options);
  } catch (err) {
    if (isNotifyMergeRefusal(err)) return { status: "blocked" };
    throw err;
  }
  if (result.action === "unchanged") return { status: "unchanged" };
  return {
    status: "installed",
    chained: result.chained,
    ephemeral: codexNotifyCommandIsEphemeral(command),
  };
}

/**
 * Assert the turn harvest for codex, which belongs to the same wiring that
 * persisted the exports: those exports carry no conversation, and this is what
 * recovers it. Idempotent, and quiet unless it changed something.
 *
 * A write that fails is not worth failing the persist over, since the exports
 * it rides beside are already installed and capturing. The exception is a
 * config shape the merge refuses, which the user can fix and would otherwise
 * never hear about.
 */
export function assertCodexTurnHarvest(): void {
  let outcome: CodexTurnHarvestOutcome;
  try {
    outcome = installCodexTurnHarvest();
  } catch (err) {
    // Never silent: with the exporters in and the harvest out, plain codex
    // reports tokens but no conversation, and the user has no way to know.
    console.log(
      chalk.yellow(
        `  ! Could not wire the codex turn harvest: ${(err as Error).message}\n` +
          "    Plain codex runs will report tokens but no conversation until it is wired.",
      ),
    );
    return;
  }
  if (outcome.status === "blocked") {
    console.log(chalk.yellow(`  ! ${CODEX_TURN_HARVEST_BLOCKED_MESSAGE}`));
    return;
  }
  if (outcome.status === "skipped") {
    console.log(
      chalk.yellow(
        "  ! Could not determine the langwatch entry to run the codex turn harvest.\n" +
          "    Reinstall the CLI (npm i -g langwatch), then run `langwatch instrument codex` again.",
      ),
    );
    return;
  }
  if (outcome.status !== "installed") return;
  console.log(
    chalk.green("  ✓ Codex will record each turn's conversation as it completes"),
  );
  console.log(
    chalk.dim(
      "    Sessions from before this install: `langwatch ingest codex` recovers them.",
    ),
  );
  if (outcome.chained) {
    console.log(
      chalk.dim(`    Your existing notify program still runs: ${outcome.chained[0]}`),
    );
  }
  if (outcome.ephemeral) {
    console.log(
      chalk.yellow(
        "    Heads up: this points at an npx cache that npm may clean up.\n" +
          "    Install the CLI (npm i -g langwatch) so it keeps working.",
      ),
    );
  }
}

/**
 * Wire the session context seam for a tool whose telemetry exports live in its
 * own settings file, on the run where the user just consented. Claude Code
 * exports no repository identity over telemetry; the seam is what reports it,
 * and it belongs to the same "yes" that persisted the exports.
 *
 * The plugin is the seam we want, so this is the one moment allowed to install
 * it: the user is present, so a marketplace trust prompt can reach them, and
 * they just answered a question that named the plugin. Anything that stops the
 * plugin from landing (a `claude` too old for it, a network that is down) falls
 * back to the hook entries written straight into the settings file, which are
 * what this always did.
 */
function installClaudeSessionContext(tool: string): void {
  if (tool !== "claude") return;

  const plugin = ensureLangwatchClaudePlugin({ interactive: true });
  if (plugin.action === "installed") {
    console.log(
      chalk.green(
        `  ✓ Installed the LangWatch Claude Code plugin, whose hooks report each session's repository and branch`,
      ),
    );
    return;
  }
  if (plugin.action === "already_installed") return;

  installRawSessionContextHooks();
}

/**
 * Re-assert the session context seam on a run that is only verifying an
 * already-configured device. Nobody was asked anything on this run, so it does
 * no network and spawns nothing: it reads what is on disk and edits local files.
 *
 * The one thing it does change is leftovers. A device that took the plugin on a
 * previous run may still carry the raw hook entries the plugin replaced, and
 * leaving both wired runs the same two hooks twice per session.
 */
function reassertClaudeSessionContext(tool: string): void {
  if (tool !== "claude") return;

  if (readClaudePluginState().pluginInstalled) {
    try {
      removeSessionContextHooks({ tool: "claude_code" });
    } catch {
      // Best-effort: a duplicate hook is worse than tidy, not broken.
    }
    return;
  }

  installRawSessionContextHooks();
}

/**
 * Merge the hook entries into the settings file. Idempotent, and quiet unless it
 * changed something. A hook write that fails is not worth failing the persist
 * over: the exports it rides beside are already installed.
 */
function installRawSessionContextHooks(): void {
  try {
    const hooks = installSessionContextHooks({ tool: "claude_code" });
    if (hooks.action === "unchanged") return;
    console.log(
      chalk.green(
        `  ✓ Installed the hooks that report each session's repository and branch`,
      ),
    );
  } catch {
    // Best-effort, the same way the telemetry refresh treats them.
  }
}

function recordNeverChoice(cfg: GovernanceConfig): void {
  cfg.shell_rc_preference = "skip";
  try {
    saveConfig(cfg);
  } catch {
    // best effort — a config write failure just means the next run re-asks.
  }
}

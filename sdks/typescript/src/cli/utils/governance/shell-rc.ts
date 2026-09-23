/**
 * Persists the langwatch export block to the user's shell rc file so a new
 * shell auto-picks up gateway + OTLP env vars. Marker-bracketed for repeat-run
 * idempotency; an already-configured shell (env vars already set) is skipped.
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
import { assertCodexAgentGuidance } from "./codex-agents-md";
import { type GovernanceConfig, saveConfig } from "./config";
import { installSessionContextHooks, removeSessionContextHooks } from "./session-context-hooks";

/**
 * Tools whose Path B telemetry persists as a scoped shell function. It
 * re-injects OTel env after the wrapper's exports, so a gateway run must
 * unset it from the shell session, never the rc file.
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
 * Per-tool marker pair for a scoped wrapper function, which sets telemetry
 * env only for `<tool>` invocations instead of a global `export` that leaks
 * into every shell child. Each tool gets its own pair so wrappers coexist.
 */
export function toolMarkers(tool: string): { begin: string; end: string } {
  return {
    begin: `# >>> langwatch ${tool} begin >>>`,
    end: `# <<< langwatch ${tool} end <<<`,
  };
}

export type DetectedShell = "zsh" | "bash" | "fish";

/**
 * Best-effort shell detection from $SHELL, falling back to zsh on macOS and
 * bash on Linux. Null for an unsupported shell (cmd, powershell), which
 * skips the persist flow entirely.
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
 * Whether the rc file already has a langwatch marker block, checked on disk
 * rather than via env in case the user hasn't sourced it yet. `requiredKeys`
 * excludes a stale block missing a key this run needs.
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

/** The text between a well-formed pair of markers in the shell's rc file. */
function readLangwatchBlock({
  shell,
  markers,
}: {
  shell: DetectedShell;
  markers: { begin: string; end: string };
}): string | undefined {
  try {
    const content = fs.readFileSync(rcPath(shell), "utf8");
    const begin = content.indexOf(markers.begin);
    const end = content.indexOf(markers.end);
    if (begin === -1 || end === -1 || end < begin) return undefined;
    return content.slice(begin, end);
  } catch {
    return undefined;
  }
}

/**
 * Every http(s) address written in the shell's langwatch block, whole, so a
 * caller can parse the host instead of searching the block for a piece of
 * one: `://localhost` is also how `https://localhost.acme.test` starts.
 */
export function rcLangwatchBlockUrls({
  shell,
  markers = { begin: BLOCK_BEGIN, end: BLOCK_END },
}: {
  shell: DetectedShell;
  markers?: { begin: string; end: string };
}): string[] {
  const block = readLangwatchBlock({ shell, markers }) ?? "";
  return block.match(/https?:\/\/[^\s'"\\;,]+/g) ?? [];
}

function quote(s: string): string {
  if (!/[ \t\n'"$\\]/.test(s)) return s;
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/**
 * Builds a shell function scoping the OTEL telemetry env to `<tool>` only,
 * rather than exporting into every shell child; the fallback for tools with
 * no config-file env target. `command <tool>` inside it avoids recursion.
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
 * Append (or replace, if the marker block already exists) the export block to
 * the shell rc file, creating it if missing. Idempotent: a second run
 * replaces in place rather than duplicating. Returns the path written.
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
    void 0;
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
 * Removes a marker-bracketed langwatch block from the rc file, if present,
 * trimming at most one leading and trailing newline so unrelated user
 * whitespace is left alone. Returns whether a block was removed.
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
 * Prompt outcome: "yes" persists now, "no" re-asks next login, "never"
 * sets shell_rc_preference=skip for good, "skip" is non-TTY / closed stdin.
 */
export type PersistChoice = "yes" | "no" | "never" | "skip";

/**
 * `question` overrides the default wording for a tool whose "yes" buys more
 * than an env block. It must be said before the answer -- a bare Enter is a
 * yes, so it belongs in the question text, not a line printed around it.
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
 * What the persist offer asks. Claude gets its own sentence: saying yes
 * both saves the env block and installs the session-context plugin, so
 * consent must name both and what the plugin's hooks record.
 */
function persistQuestion({ tool, targetHint }: { tool: string; targetHint: string }): string {
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
 * Ingestion-mode (Path B) persist offer: once persisted, a plain `<tool>`
 * invocation inherits OTEL_EXPORTER_OTLP_* and keeps capturing. `claude`
 * writes to `~/.claude/settings.json`'s `env` block; others use the rc file.
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
        chalk.green(`  ✓ Installed langwatch telemetry exports to ${appTarget.displayPath}`),
      );
      installClaudeSessionContext(tool);
    } catch (err) {
      console.log(
        chalk.yellow(`  ! Couldn't write to ${appTarget.displayPath}: ${(err as Error).message}`),
      );
    }
    return;
  }

  // codex already captures via the wrapper's per-run [otel] write in
  // ~/.codex/config.toml. What can still be missing on an older install is
  // the turn harvest (notify hook), asserted here under the same grant.
  if (tool === "codex") {
    assertCodexTurnHarvest();
    assertCodexAgentGuidance();
    return;
  }

  const shell = detectShell();
  if (!shell) return;

  // Remaining tools ride on generic OTEL_* names with no config-file target,
  // so install a scoped wrapper function per tool rather than a global
  // `export` that would leak into every shell child. (cursor never reaches
  // here -- it is gateway-only, so Path B ingestion never resolves for it.)
  const markers = toolMarkers(tool);
  // Already installed for this endpoint, even if this shell hasn't sourced the
  // rc yet (so the OTEL env isn't in process.env). Keyed on the endpoint so a
  // stale wrapper for a different endpoint doesn't suppress installing this one.
  const requiredKeys = [vars.OTEL_EXPORTER_OTLP_ENDPOINT].filter(Boolean) as string[];
  if (rcHasLangwatchBlock({ shell, requiredKeys, markers })) {
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
    const wrote = persistBlockToRc(shell, buildScopedToolFunction(tool, vars, shell), markers);
    console.log(chalk.green(`  ✓ Installed a scoped \`${tool}\` telemetry wrapper in ${wrote}`));
  } catch (err) {
    console.log(chalk.yellow(`  ! Couldn't write to ${target}: ${(err as Error).message}`));
  }
}

/**
 * What asking codex to run the turn harvest left behind. `blocked` is an
 * outcome, not a thrown error, because it is the one failure the user can
 * fix; callers report it and carry on rather than abandon a working install.
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
 * Codex's telemetry drops the conversation; pointed at our harvest, `notify`
 * is what turns a plain `codex` run into traces with something to read.
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
 * Asserts the codex turn harvest, recovering conversation content the
 * exports alone don't carry. Idempotent and quiet unless changed; a write
 * failure doesn't fail the persist, except a config shape the merge refuses.
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
  console.log(chalk.green("  ✓ Codex will record each turn's conversation as it completes"));
  console.log(
    chalk.dim("    Sessions from before this install: `langwatch ingest codex` recovers them."),
  );
  if (outcome.chained) {
    console.log(chalk.dim(`    Your existing notify program still runs: ${outcome.chained[0]}`));
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
 * Wires the session context seam on the run the user just consented: Claude
 * Code exports no repository identity over telemetry, so this reports it.
 * The one moment allowed to install the plugin; failure falls back to raw hooks.
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
 * Re-asserts the session context seam when only verifying an already
 * configured device -- local file edits only. Removes leftover raw hooks a
 * previous plugin install replaced, so no hook runs twice per session.
 */
function reassertClaudeSessionContext(tool: string): void {
  if (tool !== "claude") return;

  if (readClaudePluginState().pluginInstalled) {
    try {
      removeSessionContextHooks({ tool: "claude_code" });
    } catch {
      // Best-effort: a duplicate hook is worse than tidy, not broken.
      void 0;
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
      chalk.green(`  ✓ Installed the hooks that report each session's repository and branch`),
    );
  } catch {
    // Best-effort, the same way the telemetry refresh treats them.
    void 0;
  }
}

function recordNeverChoice(cfg: GovernanceConfig): void {
  cfg.shell_rc_preference = "skip";
  try {
    saveConfig(cfg);
  } catch {
    // best effort — a config write failure just means the next run re-asks.
    void 0;
  }
}

/**
 * The LangWatch Claude Code plugin: what Claude Code knows about it, how it
 * gets installed, and how it gets taken off again.
 *
 * The plugin carries the session context hooks (SessionStart and Stop) that
 * report which repository, branch and worktree a session ran in. The CLI used
 * to write those two entries straight into `~/.claude/settings.json`, and that
 * has two costs a plugin does not have:
 *
 *   - Invisibility. Nothing presents a raw hook entry as a LangWatch feature,
 *     so it reads as an unexplained command wired into every session. A plugin
 *     is listed by name, with everything it does inside it.
 *   - Version coupling. The entry names a subcommand of whatever `langwatch`
 *     happens to be on PATH, so a global CLI older than that subcommand answers
 *     every session stop with `error: unknown command 'hook'`. The plugin ships
 *     its own hook script and is versioned on its own.
 *
 * What does NOT move here is the telemetry env block. Claude Code reads its
 * OTLP exporter configuration from `~/.claude/settings.json` and from nowhere
 * else, and a plugin cannot set a session's environment, so the env block stays
 * CLI-managed (see app-settings.ts) whichever seam carries the hooks.
 *
 * Everything in this file is best-effort by construction. A `claude` too old to
 * take a plugin, a network that is down, a marketplace that will not clone: none
 * of them may fail the coding session the user actually asked for. Every entry
 * point reports what happened and leaves the caller free to fall back to the raw
 * hook entries in session-context-hooks.ts.
 *
 * Spec: specs/ai-governance/cli-wrappers/claude-plugin-install.feature
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { appSettingsTargetFor, readAppSettingsFileForUpdate } from "./app-settings";
import { loadConfig, saveConfig } from "./config";
import { removeSessionContextHooks } from "./session-context-hooks";

/** The plugin's name inside its marketplace. */
export const CLAUDE_PLUGIN_NAME = "langwatch";

/** The marketplace the plugin is published from, as Claude Code names it. */
export const CLAUDE_PLUGIN_MARKETPLACE = "langwatch";

/** The repository `claude plugin marketplace add` is pointed at. */
export const CLAUDE_PLUGIN_MARKETPLACE_REPO = "langwatch/agent-plugin";

/**
 * How the plugin is addressed everywhere Claude Code names it: on the command
 * line, as the key of its install record, and as the key under `enabledPlugins`.
 */
export const CLAUDE_PLUGIN_REF = `${CLAUDE_PLUGIN_NAME}@${CLAUDE_PLUGIN_MARKETPLACE}`;

/**
 * The binary. The same name the wrapper spawns for a `langwatch claude` run, so
 * plugin management resolves through exactly the PATH the session will.
 */
const CLAUDE_BINARY = "claude";

/** A local `--help` parse. Generous enough for a cold node start, no more. */
const PROBE_TIMEOUT_MS = 10_000;

/**
 * Marketplace add and plugin install clone a repository and may ask the user to
 * trust it. Long enough for a slow network and a moment's thought, short enough
 * that an unattended prompt cannot hold a session open forever.
 */
const INSTALL_TIMEOUT_MS = 120_000;

/**
 * How long a failed install suppresses the next attempt. A `claude` that could
 * not install the plugin today is overwhelmingly likely to fail the same way in
 * the next hour, and retrying on every single wrapped session would spend a
 * subprocess and a clone each time to learn it again.
 */
const RETRY_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * `DEBUG=langwatch:claude-plugin` (or any DEBUG containing "langwatch") turns
 * the subprocess failures into stderr lines. Off by default: a fallback that
 * worked is not something a coding session should narrate.
 */
function debugLog(message: string): void {
  if (!process.env.DEBUG?.includes("langwatch")) return;
  process.stderr.write(`langwatch:claude-plugin ${message}\n`);
}

/**
 * What Claude Code currently records about the plugin, read off disk.
 *
 * Every field answers "no" for state we cannot read: a missing file, JSON that
 * will not parse, or a shape we do not recognise all mean the same thing to
 * every caller, which is that there is nothing here to reuse or remove.
 */
export interface ClaudePluginState {
  /** An install record exists for the plugin, at any scope. */
  pluginInstalled: boolean;
  /** A marketplace is registered under our name, whoever owns it. */
  marketplaceKnown: boolean;
  /** ...and its source points at the repository we publish from. */
  marketplaceOwnedByLangwatch: boolean;
  /** `enabledPlugins` in the settings file has the plugin switched on. */
  enabled: boolean;
}

let pluginCliAvailable: boolean | undefined;

/**
 * Whether this `claude` understands `claude plugin` at all. Old releases have no
 * such subcommand, and asking them to install one exits non-zero with a usage
 * error, so probe once and fall back to the raw hook entries for the rest of the
 * process.
 *
 * Memoized per process: the binary cannot grow a subcommand mid-run, and the
 * wrapper may ask more than once.
 */
export function claudePluginCliAvailable(): boolean {
  if (pluginCliAvailable !== undefined) return pluginCliAvailable;
  pluginCliAvailable = probePluginCli();
  return pluginCliAvailable;
}

function probePluginCli(): boolean {
  const result = runClaude({ args: ["plugin", "--help"], timeoutMs: PROBE_TIMEOUT_MS });
  if (result.status !== 0) {
    debugLog(`plugin subcommand unavailable: ${result.detail}`);
  }
  return result.status === 0;
}

/**
 * The Claude Code settings file. app-settings owns the location, keyed by the
 * wrapped tool's slug, and always has one for claude. Note the slug is `claude`
 * while the plugin's own name is `langwatch`: they are different names for
 * different things and must not be crossed.
 */
function claudeSettingsPath(): string {
  return appSettingsTargetFor("claude")!.path;
}

/** Where Claude Code keeps its plugin bookkeeping, beside the settings file. */
function claudeHomeDir(): string {
  return path.dirname(claudeSettingsPath());
}

/**
 * Read the three files Claude Code keeps the plugin's state in. Tolerant by
 * design: these are somebody else's files in somebody else's format, and a shape
 * we do not recognise must degrade to "not installed" rather than throw into a
 * coding session.
 */
export function readClaudePluginState(): ClaudePluginState {
  const pluginsDir = path.join(claudeHomeDir(), "plugins");
  const installed = readJsonObject(path.join(pluginsDir, "installed_plugins.json"));
  const marketplaces = readJsonObject(path.join(pluginsDir, "known_marketplaces.json"));
  const settings = readJsonObject(claudeSettingsPath());

  const marketplaceCandidate = marketplaces[CLAUDE_PLUGIN_MARKETPLACE];
  const marketplaceEntry = isPlainObject(marketplaceCandidate)
    ? marketplaceCandidate
    : null;
  const enabledPlugins = isPlainObject(settings.enabledPlugins)
    ? settings.enabledPlugins
    : {};

  return {
    pluginInstalled: hasInstallRecord(installed),
    marketplaceKnown: marketplaceEntry !== null,
    marketplaceOwnedByLangwatch:
      marketplaceEntry !== null && sourcePointsAtLangwatch(marketplaceEntry.source),
    enabled: enabledPlugins[CLAUDE_PLUGIN_REF] === true,
  };
}

/**
 * `installed_plugins.json` holds `{ version, plugins: { "<name>@<marketplace>":
 * [ { scope, ... } ] } }`. An entry present with anything in it counts: which
 * scope it was installed at is the user's business, and a record we half
 * recognise still means removing rather than installing is the right move.
 */
function hasInstallRecord(document: Record<string, unknown>): boolean {
  const plugins = isPlainObject(document.plugins) ? document.plugins : document;
  const record = plugins[CLAUDE_PLUGIN_REF];
  if (Array.isArray(record)) return record.length > 0;
  if (isPlainObject(record)) return true;
  return record === true;
}

/**
 * Whether a known-marketplace entry's source is the repository we publish from.
 * The name alone proves nothing: anyone may register a marketplace called
 * `langwatch`, and removing theirs on our logout would be taking something that
 * is not ours.
 *
 * Read liberally, because Claude Code records a source several ways: github
 * shorthand (`{ source: "github", repo: "langwatch/agent-plugin" }`), a git URL,
 * or a local path. Any of them naming the repository is ours. The boundaries
 * matter, though: `evil-langwatch/agent-plugin` and `langwatch/agent-plugin-fork`
 * both contain the name and belong to somebody else.
 */
const OWNED_REPO_PATTERN = new RegExp(
  `(?<![\\w-])${CLAUDE_PLUGIN_MARKETPLACE_REPO.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`,
);

function sourcePointsAtLangwatch(source: unknown): boolean {
  if (source === undefined || source === null) return false;
  const haystack = (
    typeof source === "string" ? source : safeStringify(source)
  ).toLowerCase();
  return OWNED_REPO_PATTERN.test(haystack);
}

export type ClaudePluginEnsureAction =
  | "installed"
  | "already_installed"
  | "unavailable"
  | "skipped_recent_failure"
  | "failed";

export interface ClaudePluginEnsureResult {
  action: ClaudePluginEnsureAction;
  /** Why it could not be installed, for the caller's debug line. */
  reason?: string;
}

/**
 * Put the plugin on this machine, or report why it could not be. Never throws:
 * every caller is in the middle of setting up a coding session, and the raw hook
 * entries are a working fallback for every failure here.
 *
 * `interactive` decides who sees the subprocess. Installing a plugin can ask the
 * user to trust the marketplace, and a prompt written to a pipe nobody reads is
 * a hang, so an install the user just consented to inherits stdio. An install
 * nobody is watching captures its output instead.
 *
 * On success the raw hook entries are removed: they and the plugin declare the
 * same two hooks, and leaving both wired runs each of them twice per session.
 */
export function ensureLangwatchClaudePlugin({
  interactive,
}: {
  interactive: boolean;
}): ClaudePluginEnsureResult {
  try {
    if (readClaudePluginState().pluginInstalled) {
      migrateAwayFromRawHooks();
      return { action: "already_installed" };
    }

    const failedAt = loadConfig().claude_plugin_last_failure;
    if (typeof failedAt === "number" && Date.now() - failedAt * 1000 < RETRY_AFTER_MS) {
      return { action: "skipped_recent_failure" };
    }

    if (!claudePluginCliAvailable()) {
      return { action: "unavailable", reason: "this claude has no plugin subcommand" };
    }

    const add = runClaude({
      args: ["plugin", "marketplace", "add", CLAUDE_PLUGIN_MARKETPLACE_REPO],
      timeoutMs: INSTALL_TIMEOUT_MS,
    });
    // A non-zero add is only fatal if the marketplace really is not there
    // afterwards: re-adding one Claude Code already knows exits non-zero, and
    // that is the common case on a machine that installed the plugin before.
    if (add.status !== 0 && !readClaudePluginState().marketplaceKnown) {
      return recordFailure(`marketplace add failed: ${add.detail}`);
    }

    const install = runClaude({
      args: ["plugin", "install", CLAUDE_PLUGIN_REF, "--scope", "user"],
      timeoutMs: INSTALL_TIMEOUT_MS,
      interactive,
    });
    if (install.status !== 0 && !readClaudePluginState().pluginInstalled) {
      return recordFailure(`plugin install failed: ${install.detail}`);
    }

    clearRecordedFailure();
    migrateAwayFromRawHooks();
    return { action: "installed" };
  } catch (err) {
    return recordFailure((err as Error).message);
  }
}

export type ClaudePluginRemovalAction =
  | "uninstalled"
  | "disabled"
  | "absent"
  | "failed";

export interface ClaudePluginRemovalResult {
  action: ClaudePluginRemovalAction;
  /** Why it could not be removed, for the caller's debug line. */
  reason?: string;
}

/**
 * Take the plugin off this machine. Reads state first so a machine that never
 * had it spends no subprocess finding that out, which is what keeps the logout
 * scan cheap for the users who only ever wrapped codex.
 *
 * When the subcommand cannot remove it, switching it off in `enabledPlugins` is
 * the fallback that matters: logout revokes the token, and a plugin left enabled
 * keeps firing hooks at a collector that will reject every one of them.
 */
export function uninstallLangwatchClaudePlugin(): ClaudePluginRemovalResult {
  try {
    const state = readClaudePluginState();
    if (!state.pluginInstalled && !state.enabled) return { action: "absent" };

    if (claudePluginCliAvailable()) {
      const result = runClaude({
        args: ["plugin", "uninstall", CLAUDE_PLUGIN_REF, "--scope", "user"],
        timeoutMs: INSTALL_TIMEOUT_MS,
      });
      if (result.status === 0 || !readClaudePluginState().pluginInstalled) {
        return { action: "uninstalled" };
      }
      debugLog(`plugin uninstall failed: ${result.detail}`);
    }

    return disableInSettings()
      ? { action: "disabled" }
      : { action: "failed", reason: "the plugin could not be uninstalled or disabled" };
  } catch (err) {
    return { action: "failed", reason: (err as Error).message };
  }
}

/**
 * Deregister the marketplace, but only the one we registered. A marketplace of
 * the same name pointing somewhere else belongs to whoever added it, and logout
 * removing it would cost them every plugin they installed from it.
 *
 * Returns true when the registration is gone.
 */
export function removeLangwatchClaudeMarketplace(): boolean {
  try {
    if (!readClaudePluginState().marketplaceOwnedByLangwatch) return false;
    if (!claudePluginCliAvailable()) return false;

    const result = runClaude({
      args: ["plugin", "marketplace", "remove", CLAUDE_PLUGIN_MARKETPLACE],
      timeoutMs: INSTALL_TIMEOUT_MS,
    });
    if (result.status === 0) return true;
    debugLog(`marketplace remove failed: ${result.detail}`);
    return !readClaudePluginState().marketplaceKnown;
  } catch (err) {
    debugLog(`marketplace remove threw: ${(err as Error).message}`);
    return false;
  }
}

/**
 * Strip the raw hook entries the plugin now carries. Best-effort: the plugin is
 * installed either way, and a settings file we cannot write is not a reason to
 * report the install as failed.
 */
function migrateAwayFromRawHooks(): void {
  try {
    removeSessionContextHooks({ tool: "claude_code" });
  } catch (err) {
    debugLog(`could not remove the raw hook entries: ${(err as Error).message}`);
  }
}

/** Switch the plugin off in the settings file, preserving everything else. */
function disableInSettings(): boolean {
  const filePath = claudeSettingsPath();
  try {
    const settings = readAppSettingsFileForUpdate(filePath);
    const enabled = isPlainObject(settings.enabledPlugins)
      ? { ...settings.enabledPlugins }
      : {};
    if (enabled[CLAUDE_PLUGIN_REF] === false) return false;
    enabled[CLAUDE_PLUGIN_REF] = false;
    settings.enabledPlugins = enabled;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(settings, null, 2) + "\n");
    return true;
  } catch (err) {
    debugLog(`could not disable the plugin in the settings file: ${(err as Error).message}`);
    return false;
  }
}

/**
 * Stamp the failure so the next wrapped session does not pay for the same
 * discovery. Best-effort: a config we cannot write only costs an extra attempt.
 */
function recordFailure(reason: string): ClaudePluginEnsureResult {
  debugLog(reason);
  try {
    const cfg = loadConfig();
    cfg.claude_plugin_last_failure = Math.floor(Date.now() / 1000);
    saveConfig(cfg);
  } catch {
    // The fallback still runs; only the suppression window went unwritten.
  }
  return { action: "failed", reason };
}

/** Drop the suppression stamp once an install succeeds. */
function clearRecordedFailure(): void {
  try {
    const cfg = loadConfig();
    if (cfg.claude_plugin_last_failure === undefined) return;
    delete cfg.claude_plugin_last_failure;
    saveConfig(cfg);
  } catch {
    // A stale stamp only suppresses an install that already happened.
  }
}

interface ClaudeRunResult {
  /** The exit status, or null when the process could not run at all. */
  status: number | null;
  /** One line naming what went wrong, for the debug log. */
  detail: string;
}

/**
 * Run `claude` with a bound on how long it may take. Errors are values here, not
 * exceptions: a missing binary, a timeout and a non-zero exit all mean the same
 * thing to every caller, which is that the fallback runs.
 */
function runClaude({
  args,
  timeoutMs,
  interactive = false,
}: {
  args: string[];
  timeoutMs: number;
  interactive?: boolean;
}): ClaudeRunResult {
  try {
    const result = spawnSync(CLAUDE_BINARY, args, {
      encoding: "utf8",
      timeout: timeoutMs,
      // A trust prompt written to a pipe nobody reads is a hang, so an install
      // the user is watching gets the terminal. Everything else is captured.
      stdio: interactive ? "inherit" : ["ignore", "pipe", "pipe"],
    });
    if (result.error) {
      return { status: null, detail: result.error.message };
    }
    const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
    return {
      status: result.status,
      detail: stderr || `exit status ${String(result.status)}`,
    };
  } catch (err) {
    return { status: null, detail: (err as Error).message };
  }
}

function readJsonObject(filePath: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

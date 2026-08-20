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
 * Shipping the hook inside the plugin only solves the drift it was built to
 * solve while the installed copy keeps up with what we publish, and Claude Code
 * will not see to that: it auto-updates its own marketplaces and leaves
 * third-party ones like ours switched off by default. So the plugin is also
 * updated from here, once a day, from whichever wrapped run comes first.
 *
 * Everything in this file is best-effort by construction. A `claude` too old to
 * take a plugin, a network that is down, a marketplace that will not clone: none
 * of them may fail the coding session the user actually asked for. Every entry
 * point reports what happened and leaves the caller free to fall back to the raw
 * hook entries in session-context-hooks.ts.
 *
 * Specs:
 *   specs/ai-governance/cli-wrappers/claude-plugin-install.feature
 *   specs/ai-governance/cli-wrappers/claude-plugin-update.feature
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { compareVersions } from "../compare-versions";
import {
  appSettingsTargetFor,
  readAppSettingsFileForUpdate,
  writeAppSettingsFile,
} from "./app-settings";
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
 * How long a completed update check suppresses the next one. The plugin moves
 * when we cut a release, which is nowhere near often enough to be worth a
 * repository fetch per wrapped launch, and a day is short enough that a fix
 * reaches a machine the day after it ships.
 */
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Refreshing the listing and applying an update are each a fetch of a small
 * repository, so this is generous for the work and deliberately far below the
 * install timeout. Both can run on the way into a launch the user never asked
 * to involve Claude Code in, and they run back to back, so the number that
 * matters is the two of them plus the probe: a wrapped run waits at most a
 * bit over a minute on a network that has stopped answering, having said so
 * first, rather than the two minutes a matching install timeout would cost.
 */
const UPDATE_TIMEOUT_MS = 30_000;

/**
 * A version we are willing to reason about. Anything else (absent, a git sha, a
 * shape we do not recognise) means we do not know what is installed, and the
 * safe answer to that is to leave it alone rather than update it blindly.
 */
const VERSION_PATTERN = /^\d+\.\d+\.\d+/;

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
  const result = runClaude({
    args: ["plugin", "--help"],
    timeoutMs: PROBE_TIMEOUT_MS,
  });
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
function claudePluginsDir(): string {
  return path.join(path.dirname(claudeSettingsPath()), "plugins");
}

/**
 * Read the three files Claude Code keeps the plugin's state in. Tolerant by
 * design: these are somebody else's files in somebody else's format, and a shape
 * we do not recognise must degrade to "not installed" rather than throw into a
 * coding session.
 */
export function readClaudePluginState(): ClaudePluginState {
  const pluginsDir = claudePluginsDir();
  const installed = readJsonObject(
    path.join(pluginsDir, "installed_plugins.json"),
  );
  const marketplaces = readJsonObject(
    path.join(pluginsDir, "known_marketplaces.json"),
  );
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
      marketplaceEntry !== null &&
      sourcePointsAtLangwatch(marketplaceEntry.source),
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
 * Claude Code records a source several ways: github shorthand
 * (`{ source: "github", repo: "langwatch/agent-plugin" }`), a git URL, or a
 * local path. Only an exact, canonical GitHub identity counts. Everything else
 * belongs to whoever registered it, including the near misses built to read
 * like us: `evil-langwatch/agent-plugin`, `langwatch/agent-plugin-fork`,
 * `github.com/langwatch/agent-plugin.evil`, and any host that is not GitHub.
 */
/**
 * The hosts a canonical registration can name. Nothing else qualifies: the
 * plugin is published to GitHub and only to GitHub, so a source anywhere else
 * is by definition not the one we publish, whatever it is called.
 */
const OWNED_HOSTS = new Set(["github.com", "www.github.com"]);

/**
 * The protocols git registrations use. A `file:` source is deliberately absent:
 * a local checkout is somebody's working copy, and it is not something we
 * should be pulling new code into a user's agent from on a timer.
 */
const OWNED_PROTOCOLS = new Set(["https:", "http:", "ssh:", "git:"]);

/**
 * The fields that say WHERE a marketplace comes from, across the shapes Claude
 * Code writes. Only these decide ownership: a description, a commit message or
 * any other metadata that happens to mention the repository says nothing about
 * who published the marketplace, and reading the whole entry would hand
 * somebody else's registration to our logout.
 */
const SOURCE_IDENTITY_KEYS = ["source", "repo", "url", "path"] as const;

/**
 * Whether one source field names the repository we publish from, and names it
 * exactly. Parsed rather than pattern-matched, because the interesting inputs
 * are the ones built to look right: `github.com/langwatch/agent-plugin.evil`,
 * `evil.example/?repo=langwatch/agent-plugin` and a local directory that
 * happens to sit at that path all contain our repository name and none of them
 * are us.
 *
 * The stakes are what make exactness worth the parser. This gate decides both
 * what logout may deregister and, now, what a wrapped run may pull new code
 * into the user's agent from without asking.
 */
function pointsAtOwnedRepo(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const raw = value.trim();
  if (raw === "") return false;
  const lowered = raw.toLowerCase();

  // The shorthand `claude plugin marketplace add` takes, which is how the CLI
  // registers it and therefore the case that matters most.
  if (lowered === CLAUDE_PLUGIN_MARKETPLACE_REPO) return true;

  const scp = /^git@([^:]+):(.+)$/.exec(lowered);
  if (scp) {
    return (
      OWNED_HOSTS.has(scp[1]!) &&
      stripRepoPath(scp[2]!) === CLAUDE_PLUGIN_MARKETPLACE_REPO
    );
  }

  try {
    const url = new URL(raw);
    if (!OWNED_PROTOCOLS.has(url.protocol)) return false;
    if (!OWNED_HOSTS.has(url.hostname.toLowerCase())) return false;
    // A query or a fragment means the path is not the whole address, and we do
    // not know what the rest of it does.
    if (url.search !== "" || url.hash !== "") return false;
    return (
      stripRepoPath(url.pathname.toLowerCase()) ===
      CLAUDE_PLUGIN_MARKETPLACE_REPO
    );
  } catch {
    // Not a URL. A bare path is a local checkout, which is never ours.
    return false;
  }
}

/** `/langwatch/agent-plugin.git/` and friends down to `langwatch/agent-plugin`. */
function stripRepoPath(value: string): string {
  return value
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/, "");
}

function sourcePointsAtLangwatch(source: unknown): boolean {
  if (typeof source === "string") return pointsAtOwnedRepo(source);
  if (!isPlainObject(source)) return false;
  return SOURCE_IDENTITY_KEYS.some((key) => pointsAtOwnedRepo(source[key]));
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
    if (typeof failedAt === "number") {
      // Bounded at both ends. A stamp in the future is not a recent failure,
      // it is a clock that went backwards or a config copied from a machine
      // ahead of this one, and reading it as recent suppresses every install
      // until wall-clock time catches up.
      const sinceFailure = Date.now() - failedAt * 1000;
      if (sinceFailure >= 0 && sinceFailure < RETRY_AFTER_MS) {
        return { action: "skipped_recent_failure" };
      }
    }

    if (!claudePluginCliAvailable()) {
      return {
        action: "unavailable",
        reason: "this claude has no plugin subcommand",
      };
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

export type ClaudePluginUpdateAction =
  /** The installed copy was behind the listing and has been moved forward. */
  | "updated"
  /** The installed copy is the published one. */
  | "up_to_date"
  /** Nothing of ours is installed, so there is nothing to keep current. */
  | "absent"
  /** A check inside the last day already answered this. */
  | "checked_recently"
  /** This `claude` cannot manage plugins, or the marketplace is not ours. */
  | "unavailable"
  /** One of the two versions could not be read, so neither is trusted. */
  | "unknown_version"
  /** The listing could not be refreshed, or the update would not apply. */
  | "failed";

export interface ClaudePluginUpdateResult {
  action: ClaudePluginUpdateAction;
  /** The version that was installed before this ran. */
  from?: string;
  /** The version now installed, on an update. */
  to?: string;
  /** What went wrong, for the caller's warning. */
  reason?: string;
}

/**
 * Bring the installed plugin up to the version the marketplace publishes, at
 * most once a day. Never throws: this runs on the way into a coding session
 * that has nothing to do with plugin housekeeping, so every failure here is a
 * warning the caller prints and then gets on with the launch.
 *
 * Ordered so the cheap answers come first. A machine without the plugin and a
 * machine already checked today both return without spawning anything, which is
 * what the overwhelming majority of wrapped runs do.
 *
 * The check is stamped BEFORE the work rather than after it, so a fetch that
 * hangs until the timeout, or a process killed in the middle of one, costs the
 * next launch nothing. The price is that a transient failure waits a day for
 * its retry, which is the right trade for housekeeping: the plugin that is
 * installed keeps working, it is only a version behind.
 */
export function updateLangwatchClaudePlugin({
  onCheckStart,
}: {
  /**
   * Called once, immediately before the first subprocess, and not at all on
   * the runs that answer from disk. The work behind it is a network fetch on
   * somebody's way into a coding session, so the caller gets the chance to say
   * what the pause is for rather than leaving a silent terminal.
   */
  onCheckStart?: () => void;
} = {}): ClaudePluginUpdateResult {
  try {
    const ineligible = updateEligibility();
    if (ineligible) return ineligible;

    onCheckStart?.();

    // The listing on disk is a clone, and it is as old as the last time
    // something refreshed it. Refresh first so the version we compare against
    // is what we publish today rather than what we published when the user
    // installed.
    const refresh = runClaude({
      args: ["plugin", "marketplace", "update", CLAUDE_PLUGIN_MARKETPLACE],
      timeoutMs: UPDATE_TIMEOUT_MS,
    });
    const refreshFailure =
      refresh.status === 0
        ? null
        : `the marketplace listing could not be refreshed: ${refresh.detail}`;
    if (refreshFailure) debugLog(refreshFailure);

    const installed = readInstalledPluginVersion();
    const published = readPublishedPluginVersion();
    if (!installed || !published) {
      // Not a failed operation, so it stays off the user's terminal: there is
      // no action for them in it, and a daily line about a state they cannot
      // influence is noise. It is the shape a Claude Code layout change would
      // take, though, so make it findable.
      debugLog(
        `left the plugin alone, versions unread (installed=${installed ?? "?"}, published=${published ?? "?"})`,
      );
      return {
        action: "unknown_version",
        reason: refreshFailure ?? undefined,
        from: installed ?? undefined,
      };
    }

    // Equal is the common case. Ahead of the listing happens on a machine that
    // installed from a local checkout, and dragging that backwards to what we
    // published would undo somebody's testing.
    if (compareVersions({ version: installed, against: published }) >= 0) {
      // A refresh that failed leaves this unproven: the listing we just
      // compared against is whatever was already on disk, which may be older
      // than the release we are trying to deliver.
      return refreshFailure
        ? { action: "failed", from: installed, reason: refreshFailure }
        : { action: "up_to_date", from: installed };
    }

    return applyUpdate({ installed, published });
  } catch (err) {
    return { action: "failed", reason: (err as Error).message };
  }
}

/**
 * Why this run should not go looking, or null when it should. Everything here
 * answers from disk, which is what keeps the runs that have nothing to do from
 * costing a subprocess.
 *
 * The paths that DID reach a conclusion about this machine stamp the check on
 * their way out. A `claude` that cannot manage plugins will not learn to before
 * tomorrow, and asking it again on every launch spends a subprocess to be told
 * the same thing.
 */
function updateEligibility(): ClaudePluginUpdateResult | null {
  // The user scope is the one this CLI installs into and the only one it may
  // move: a project or local record is a pin somebody chose for a checkout.
  // Reading it here rather than `pluginInstalled` keeps a project-only machine
  // from spending a probe and a fetch every day to reach the same conclusion.
  if (!readUserScopeInstall()) return { action: "absent" };

  if (checkedRecently(lastCheckedAt())) return { action: "checked_recently" };

  // Record the check BEFORE running it, and give up when that cannot be done.
  // A stamp that does not land is a check with no memory, and a check with no
  // memory runs on every launch for as long as the machine stays that way. It
  // also means a fetch that hangs to its timeout, or a Ctrl-C in the middle of
  // one, costs the next launch nothing.
  if (!stampUpdateCheck()) {
    return { action: "unavailable", reason: "the check could not be recorded" };
  }

  // A marketplace of our name that points somewhere else is somebody else's
  // registration, and updating what it serves is not ours to do.
  if (!readClaudePluginState().marketplaceOwnedByLangwatch) {
    return {
      action: "unavailable",
      reason: "the langwatch marketplace on this machine is not ours",
    };
  }
  if (!claudePluginCliAvailable()) {
    return {
      action: "unavailable",
      reason: "this claude has no plugin subcommand",
    };
  }
  return null;
}

/**
 * Move the installed copy to what the listing publishes, and report on what is
 * on disk afterwards rather than on the exit status: a non-zero exit that still
 * moved the version did the job, and a zero exit that moved nothing did not.
 *
 * A failure carries no `to`, because nothing was installed. The version it was
 * reaching for is in the reason, where it reads as an intention rather than as
 * a version the machine has.
 */
function applyUpdate({
  installed,
  published,
}: {
  installed: string;
  published: string;
}): ClaudePluginUpdateResult {
  const update = runClaude({
    args: ["plugin", "update", CLAUDE_PLUGIN_REF, "--scope", "user"],
    timeoutMs: UPDATE_TIMEOUT_MS,
  });
  const after = readInstalledPluginVersion();
  if (!after || compareVersions({ version: after, against: installed }) <= 0) {
    return {
      action: "failed",
      from: installed,
      reason: `the update to ${published} could not be applied: ${update.detail}`,
    };
  }
  return { action: "updated", from: installed, to: after };
}

/**
 * The install record this CLI put there, or null when the machine has none.
 * Only the user scope qualifies: a project or local record belongs to a
 * checkout somebody else pinned, and moving it would be taking that decision
 * off them.
 */
function readUserScopeInstall(): Record<string, unknown> | null {
  const document = readJsonObject(
    path.join(claudePluginsDir(), "installed_plugins.json"),
  );
  const plugins = isPlainObject(document.plugins) ? document.plugins : document;
  const records = plugins[CLAUDE_PLUGIN_REF];
  if (!Array.isArray(records)) return null;
  const userScoped = records.find(
    (record) => isPlainObject(record) && record.scope === "user",
  );
  return isPlainObject(userScoped) ? userScoped : null;
}

/** The version of that record, when it carries one we can reason about. */
function readInstalledPluginVersion(): string | null {
  const record = readUserScopeInstall();
  return record ? versionOf(record) : null;
}

/**
 * The version the marketplace listing on disk publishes. Both manifests are
 * read because both ship and the publish workflow refuses to release them
 * disagreeing: whichever one this Claude Code wrote into its clone answers.
 */
function readPublishedPluginVersion(): string | null {
  const listing = marketplaceListingDir();
  for (const manifest of [
    path.join(listing, ".claude-plugin", "plugin.json"),
    path.join(listing, "plugin.json"),
  ]) {
    const version = versionOf(readJsonObject(manifest));
    if (version) return version;
  }
  return null;
}

/**
 * Where Claude Code cloned the listing. It records the location itself, so read
 * that; the conventional path is the fallback for an entry that does not carry
 * one, and a wrong guess only costs an unreadable manifest.
 */
function marketplaceListingDir(): string {
  const marketplaces = readJsonObject(
    path.join(claudePluginsDir(), "known_marketplaces.json"),
  );
  const entry = marketplaces[CLAUDE_PLUGIN_MARKETPLACE];
  if (
    isPlainObject(entry) &&
    typeof entry.installLocation === "string" &&
    entry.installLocation
  ) {
    return entry.installLocation;
  }
  return path.join(
    claudePluginsDir(),
    "marketplaces",
    CLAUDE_PLUGIN_MARKETPLACE,
  );
}

function versionOf(document: Record<string, unknown>): string | null {
  const version = document.version;
  return typeof version === "string" && VERSION_PATTERN.test(version)
    ? version
    : null;
}

/**
 * When the last check ran, as far as the config knows. A config we cannot read
 * answers "never", which is safe here because the write that follows reads it
 * too and stops the run when it cannot.
 */
function lastCheckedAt(): number | undefined {
  try {
    const checkedAt = loadConfig().claude_plugin_last_update_check;
    return typeof checkedAt === "number" ? checkedAt : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether a check inside the last day already answered this. Bounded at both
 * ends for the same reason the install suppression is: a stamp in the future is
 * a clock that went backwards or a config copied from another machine, and
 * reading it as recent would suppress every check until time caught up.
 */
function checkedRecently(checkedAt: number | undefined): boolean {
  if (checkedAt === undefined) return false;
  const sinceCheck = Date.now() - checkedAt * 1000;
  return sinceCheck >= 0 && sinceCheck < UPDATE_CHECK_INTERVAL_MS;
}

/**
 * Record that the check is happening. Reports whether it landed, because the
 * caller uses that to decide whether to check at all: this is the one thing
 * here that is not best-effort.
 */
function stampUpdateCheck(): boolean {
  try {
    const cfg = loadConfig();
    cfg.claude_plugin_last_update_check = Math.floor(Date.now() / 1000);
    saveConfig(cfg);
    return true;
  } catch (err) {
    debugLog(
      `the update check could not be recorded: ${(err as Error).message}`,
    );
    return false;
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
      : {
          action: "failed",
          reason: "the plugin could not be uninstalled or disabled",
        };
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
    debugLog(
      `could not remove the raw hook entries: ${(err as Error).message}`,
    );
  }
}

/**
 * Switch the plugin off in the settings file, preserving everything else.
 *
 * Reports the END STATE, not whether a write happened: a plugin that is already
 * switched off is the outcome the caller wanted, and a second logout finding it
 * that way is a success. Only a state we could not reach is false.
 */
function disableInSettings(): boolean {
  const filePath = claudeSettingsPath();
  try {
    const settings = readAppSettingsFileForUpdate(filePath);
    const enabled = isPlainObject(settings.enabledPlugins)
      ? { ...settings.enabledPlugins }
      : {};
    if (enabled[CLAUDE_PLUGIN_REF] === false) return true;
    enabled[CLAUDE_PLUGIN_REF] = false;
    settings.enabledPlugins = enabled;
    writeAppSettingsFile({ filePath, settings });
    return true;
  } catch (err) {
    debugLog(
      `could not disable the plugin in the settings file: ${(err as Error).message}`,
    );
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
    const stderr =
      typeof result.stderr === "string" ? result.stderr.trim() : "";
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

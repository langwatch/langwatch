/**
 * The Claude Code hook entries that make a session report the repository it
 * ran in, merged into `~/.claude/settings.json`.
 *
 * Claude Code runs `SessionStart` at the top of every session and `Stop` at
 * the end of every turn, and it reads both from the same settings file the
 * telemetry env block lives in (see app-settings.ts). One entry per event is
 * all this needs: the command behind them decides for itself when there is
 * anything new to report.
 *
 * Ownership doctrine, the same one telemetry-targets.ts applies everywhere
 * else: hook arrays are shared with the user, so an entry is ours only when
 * the command it runs is one of ours. Every other entry, in the same array
 * or beside it, is read past and written back untouched: installing must
 * never cost someone their own hooks, and logout must never take them.
 *
 * Spec: specs/ai-governance/cli-wrappers/claude-session-context-hook.feature
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { appSettingsTargetFor, readAppSettingsFile } from "./app-settings";

/** The command the installed hook entries run. */
export const SESSION_CONTEXT_HOOK_COMMAND = "langwatch ingest hook claude-code";

/**
 * What marks an entry as ours. The prefix rather than the whole command, so
 * an entry written by an older CLI (or for another agent) is still recognised
 * as langwatch-authored and gets replaced or removed rather than duplicated.
 */
const OWNED_COMMAND_PREFIX = "langwatch ingest hook";

/** The two events a session's git context can have changed between. */
const HOOK_EVENTS = ["SessionStart", "Stop"] as const;

/** Seconds Claude Code gives the hook before it kills it. */
const HOOK_TIMEOUT_SECONDS = 10;

export type ClaudeHooksAction = "created" | "updated" | "unchanged";

export interface ClaudeHooksInstallResult {
  action: ClaudeHooksAction;
  /** Absolute path of the settings file that was merged into. */
  path: string;
  /** The same path with the home directory collapsed, for display. */
  displayPath: string;
}

interface SettingsTarget {
  path: string;
  displayPath: string;
}

/**
 * Merge the session-context hooks into the settings file, creating it and its
 * directory when missing. Idempotent: running twice leaves exactly one entry
 * per event, and reports `unchanged` the second time.
 */
export function installClaudeSessionContextHooks({
  filePath,
}: { filePath?: string } = {}): ClaudeHooksInstallResult {
  const target = resolveTarget(filePath);
  const existedBefore = fs.existsSync(target.path);

  const settings = readAppSettingsFile(target.path);
  const before = JSON.stringify(settings);

  const hooks = isPlainObject(settings.hooks) ? settings.hooks : {};
  for (const event of HOOK_EVENTS) {
    hooks[event] = mergeHookEntries(hooks[event]);
  }
  settings.hooks = hooks;

  if (JSON.stringify(settings) === before) {
    return { action: "unchanged", ...target };
  }

  fs.mkdirSync(path.dirname(target.path), { recursive: true });
  fs.writeFileSync(target.path, JSON.stringify(settings, null, 2) + "\n");
  return { action: existedBefore ? "updated" : "created", ...target };
}

/**
 * Whether the settings file currently carries any langwatch hook entry. Used
 * by the logout scan to decide whether there is anything to offer.
 */
export function hasClaudeSessionContextHooks({
  filePath,
}: { filePath?: string } = {}): boolean {
  const settings = readAppSettingsFile(resolveTarget(filePath).path);
  if (!isPlainObject(settings.hooks)) return false;
  return Object.values(settings.hooks).some(
    (entries) => Array.isArray(entries) && entries.some(isLangwatchHookEntry),
  );
}

/**
 * Strip every langwatch hook entry from the settings file, leaving the user's
 * own entries (and every other settings key) exactly as they were. An event
 * left with no entries loses its key, and an empty `hooks` object goes with
 * it, so removal leaves no residue. Returns true when the file changed.
 *
 * A file we cannot parse is left alone rather than rewritten: there is no way
 * to strip our entries from JSON we could not read without losing the rest.
 */
export function removeClaudeSessionContextHooks({
  filePath,
}: { filePath?: string } = {}): boolean {
  const target = resolveTarget(filePath);

  let raw: string;
  try {
    raw = fs.readFileSync(target.path, "utf8");
  } catch {
    return false; // ENOENT
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return false; // malformed, do not touch
  }
  if (!isPlainObject(parsed)) return false;

  const settings: Record<string, unknown> = { ...parsed };
  if (!isPlainObject(settings.hooks)) return false;
  const hooks: Record<string, unknown> = { ...settings.hooks };

  let removed = false;
  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) continue;
    const kept = entries.filter((entry) => !isLangwatchHookEntry(entry));
    if (kept.length === entries.length) continue;
    removed = true;
    if (kept.length === 0) delete hooks[event];
    else hooks[event] = kept;
  }
  if (!removed) return false;

  if (Object.keys(hooks).length === 0) delete settings.hooks;
  else settings.hooks = hooks;

  fs.writeFileSync(target.path, JSON.stringify(settings, null, 2) + "\n");
  return true;
}

/**
 * The entries for one event with ours asserted: an existing entry of ours
 * that already matches keeps its position, anything else of ours is replaced
 * by exactly one current entry, and the user's entries keep their order.
 */
function mergeHookEntries(raw: unknown): unknown[] {
  const entries = Array.isArray(raw) ? (raw as unknown[]) : [];
  const ours = entries.filter(isLangwatchHookEntry);
  const desired = sessionContextHookEntry();

  if (ours.length === 1 && JSON.stringify(ours[0]) === JSON.stringify(desired)) {
    return entries;
  }
  return [...entries.filter((entry) => !isLangwatchHookEntry(entry)), desired];
}

/** No matcher: every session start counts, whatever started it. */
function sessionContextHookEntry(): Record<string, unknown> {
  return {
    hooks: [
      {
        type: "command",
        command: SESSION_CONTEXT_HOOK_COMMAND,
        timeout: HOOK_TIMEOUT_SECONDS,
      },
    ],
  };
}

function isLangwatchHookEntry(entry: unknown): boolean {
  if (!isPlainObject(entry) || !Array.isArray(entry.hooks)) return false;
  return entry.hooks.some((hook) => {
    if (!isPlainObject(hook)) return false;
    const command = hook.command;
    return (
      typeof command === "string" && command.startsWith(OWNED_COMMAND_PREFIX)
    );
  });
}

function resolveTarget(filePath: string | undefined): SettingsTarget {
  if (filePath) return { path: filePath, displayPath: filePath };
  // app-settings owns the claude settings location, and always has one.
  const target = appSettingsTargetFor("claude")!;
  return { path: target.path, displayPath: target.displayPath };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

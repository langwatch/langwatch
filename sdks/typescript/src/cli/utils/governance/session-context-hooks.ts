/**
 * The command-hook entries that make a session report the repository it ran
 * in. Ownership doctrine: an entry is ours only when the command it runs is
 * one of ours -- every other entry is read past and written back untouched.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  appSettingsTargetFor,
  readAppSettingsFile,
  readAppSettingsFileForUpdate,
  writeAppSettingsFile,
} from "./app-settings";

/** The agents whose session context rides on a command hook. */
export type HookedTool = "claude_code" | "codex";

/**
 * What marks an entry as ours. Prefixes rather than whole commands, so an
 * entry written by an older CLI (or for another agent) is still recognised as
 * langwatch-authored and gets replaced or removed rather than duplicated.
 */
const OWNED_COMMAND_PREFIX = "langwatch ingest hook";

/**
 * The guidance hook that injects the declare-your-context text as
 * SessionStart additionalContext, for a claude without plugin support.
 * Installed and removed with the session hooks.
 */
const GUIDANCE_COMMAND_PREFIX = "langwatch ingest guidance";

const OWNED_COMMAND_PREFIXES = [OWNED_COMMAND_PREFIX, GUIDANCE_COMMAND_PREFIX] as const;

/** The two events a session's git context can have changed between. */
const HOOK_EVENTS = ["SessionStart", "Stop"] as const;

/** Seconds the agent gives the hook before it kills it. */
const HOOK_TIMEOUT_SECONDS = 10;

export interface HooksTarget {
  /** Absolute path of the hook file. */
  path: string;
  /** The same path with the home directory collapsed, for display. */
  displayPath: string;
}

interface ToolSpec {
  /** The tool argument `langwatch ingest hook` is called with. */
  hookArgument: string;
  /** Where the hook declarations live, resolved at call time. */
  resolveTarget: () => HooksTarget;
}

const TARGETS: Record<HookedTool, ToolSpec> = {
  claude_code: {
    hookArgument: "claude-code",
    resolveTarget: () => {
      // app-settings owns the claude settings location, and always has one.
      const target = appSettingsTargetFor("claude")!;
      return { path: target.path, displayPath: target.displayPath };
    },
  },
  codex: {
    hookArgument: "codex",
    resolveTarget: () => {
      // CODEX_HOME relocates the whole config directory, hooks included.
      const home = process.env.CODEX_HOME?.trim();
      if (home) {
        const file = path.join(home, "hooks.json");
        return { path: file, displayPath: file };
      }
      return {
        path: path.join(os.homedir(), ".codex", "hooks.json"),
        displayPath: "~/.codex/hooks.json",
      };
    },
  },
};

/** The command an installed hook entry runs, for one agent. */
export function sessionContextHookCommand(tool: HookedTool): string {
  return `${OWNED_COMMAND_PREFIX} ${TARGETS[tool].hookArgument}`;
}

/** Where a tool's hooks live, for the logout scan's label. */
export function sessionContextHooksTarget(tool: HookedTool): HooksTarget {
  return TARGETS[tool].resolveTarget();
}

export type SessionContextHooksAction = "created" | "updated" | "unchanged";

export interface SessionContextHooksInstallResult extends HooksTarget {
  action: SessionContextHooksAction;
}

/**
 * Merges the session-context hooks into the tool's hook file, creating it
 * when missing. Idempotent -- reports `unchanged` the second run. Throws
 * when the existing file isn't a JSON object.
 */
export function installSessionContextHooks({
  tool,
  filePath,
}: {
  tool: HookedTool;
  filePath?: string;
}): SessionContextHooksInstallResult {
  const target = resolveTarget({ tool, filePath });
  const existedBefore = fs.existsSync(target.path);

  const document = readAppSettingsFileForUpdate(target.path);
  const before = JSON.stringify(document);

  const hooks = isPlainObject(document.hooks) ? document.hooks : {};
  for (const event of HOOK_EVENTS) {
    hooks[event] = mergeHookEntries({ raw: hooks[event], tool, event });
  }
  document.hooks = hooks;

  if (JSON.stringify(document) === before) {
    return { action: "unchanged", ...target };
  }

  writeAppSettingsFile({ filePath: target.path, settings: document });
  return { action: existedBefore ? "updated" : "created", ...target };
}

/**
 * Whether the tool's hook file currently carries any langwatch hook entry. Used
 * by the logout scan to decide whether there is anything to offer.
 */
export function hasSessionContextHooks({
  tool,
  filePath,
}: {
  tool: HookedTool;
  filePath?: string;
}): boolean {
  const document = readAppSettingsFile(resolveTarget({ tool, filePath }).path);
  if (!isPlainObject(document.hooks)) return false;
  return Object.values(document.hooks).some(
    (entries) => Array.isArray(entries) && entries.some(isLangwatchHookEntry),
  );
}

/**
 * Strips every langwatch hook entry, leaving the user's own entries exactly
 * as they were; an event left with none loses its key so removal leaves no
 * residue. An unparseable file is left alone. Returns whether it changed.
 */
export function removeSessionContextHooks({
  tool,
  filePath,
}: {
  tool: HookedTool;
  filePath?: string;
}): boolean {
  const target = resolveTarget({ tool, filePath });

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

  const document: Record<string, unknown> = { ...parsed };
  if (!isPlainObject(document.hooks)) return false;
  const hooks: Record<string, unknown> = { ...document.hooks };

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

  if (Object.keys(hooks).length === 0) delete document.hooks;
  else document.hooks = hooks;

  writeAppSettingsFile({ filePath: target.path, settings: document });
  return true;
}

/**
 * The entries for one event with ours asserted: an existing entry of ours that
 * already matches keeps its position, anything else of ours is replaced by
 * exactly one current entry, and the user's entries keep their order.
 */
function mergeHookEntries({
  raw,
  tool,
  event,
}: {
  raw: unknown;
  tool: HookedTool;
  event: (typeof HOOK_EVENTS)[number];
}): unknown[] {
  const entries = Array.isArray(raw) ? (raw as unknown[]) : [];
  const ours = entries.filter(isLangwatchHookEntry);
  const desired = sessionContextHookEntry(tool, event);

  if (ours.length === 1) {
    const oursJson = JSON.stringify(ours[0]);
    const desiredJson = JSON.stringify(desired);
    if (oursJson === desiredJson) {
      return entries;
    }
  }
  return [...entries.filter((entry) => !isLangwatchHookEntry(entry)), desired];
}

/**
 * No matcher: every session start counts. Still ONE entry per event --
 * claude's SessionStart carries the guidance hook as a second command, so
 * removal holds for both. Codex's guidance rides the AGENTS.md block instead.
 */
function sessionContextHookEntry(
  tool: HookedTool,
  event: (typeof HOOK_EVENTS)[number],
): Record<string, unknown> {
  const commands = [sessionContextHookCommand(tool)];
  if (tool === "claude_code" && event === "SessionStart") {
    commands.push(`${GUIDANCE_COMMAND_PREFIX} claude-code`);
  }
  return {
    hooks: commands.map((command) => ({
      type: "command",
      command,
      timeout: HOOK_TIMEOUT_SECONDS,
    })),
  };
}

function isLangwatchHookEntry(entry: unknown): boolean {
  if (!isPlainObject(entry)) return false;
  if (!Array.isArray(entry.hooks)) return false;
  return entry.hooks.some((hook) => {
    if (!isPlainObject(hook)) return false;
    const command = hook.command;
    return (
      typeof command === "string" &&
      OWNED_COMMAND_PREFIXES.some((prefix) => command.startsWith(prefix))
    );
  });
}

function resolveTarget({
  tool,
  filePath,
}: {
  tool: HookedTool;
  filePath: string | undefined;
}): HooksTarget {
  if (filePath) return { path: filePath, displayPath: filePath };
  return TARGETS[tool].resolveTarget();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

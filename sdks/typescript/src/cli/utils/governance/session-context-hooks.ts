/**
 * The hooks that make a session report its repository. An entry is ours only
 * when its command is ours; others are written back untouched. In a folder of
 * hook files (Copilot) we own one file, and only while it holds nothing else.
 */

import * as fs from "node:fs";

import {
  readAppSettingsFile,
  readAppSettingsFileForUpdate,
  writeAppSettingsFile,
} from "./app-settings";
import {
  hasOwnedHookFile,
  HOOK_TIMEOUT_SECONDS,
  type HookedTool,
  type HooksTarget,
  ownedHookFileToolForCommand,
  SESSION_CONTEXT_AGENTS,
} from "./session-context-agents";

export type { HookedTool } from "./session-context-agents";

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

/**
 * Copilot's names for the same two events, as its hook file format spells
 * them: `agentStop` closes every turn the way Claude Code's `Stop` does.
 */
const COPILOT_HOOK_EVENTS = ["sessionStart", "agentStop"] as const;

/** The only version of the Copilot hook file format there is. */
const COPILOT_HOOK_FILE_VERSION = 1;

/** The command an installed hook entry runs, for one agent. */
export function sessionContextHookCommand(tool: HookedTool): string {
  return `${OWNED_COMMAND_PREFIX} ${SESSION_CONTEXT_AGENTS[tool].hookArgument}`;
}

/** Where a tool's hooks live, for the logout scan's label. */
export function sessionContextHooksTarget(tool: HookedTool): HooksTarget {
  return SESSION_CONTEXT_AGENTS[tool].hookTarget.resolve();
}

/** `not_ours`: a file of the user's holds our path (Copilot), so nothing was written. */
export type SessionContextHooksAction = "created" | "updated" | "unchanged" | "not_ours";

export interface SessionContextHooksInstallResult extends HooksTarget {
  action: SessionContextHooksAction;
}

/**
 * Merges our hooks into the tool's hook file (or writes our own file where it
 * has one). Idempotent; throws when a shared file isn't a JSON object.
 */
export function installSessionContextHooks({
  tool,
  filePath,
}: {
  tool: HookedTool;
  filePath?: string;
}): SessionContextHooksInstallResult {
  const target = resolveTarget({ tool, filePath });
  if (hasOwnedHookFile(tool)) return installOwnedHookFile({ tool, target });
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

/** Where the wrapper for `command` writes a hook file of ours, or null when it writes none. */
export function ownedHookFileTargetFor({ command }: { command: string }): HooksTarget | null {
  const tool = ownedHookFileToolForCommand(command);
  return tool ? sessionContextHooksTarget(tool) : null;
}

/**
 * Where the wrapper for `command` would write its hook file, when a file of the
 * user's already holds that path, so a question offering to write it must not.
 */
export function ownedHookFilePathHeldByUser({ command }: { command: string }): HooksTarget | null {
  const tool = ownedHookFileToolForCommand(command);
  if (!tool) return null;
  const target = sessionContextHooksTarget(tool);
  if (!fs.existsSync(target.path)) return null;
  return readOwnedHookFile({ tool, filePath: target.path }) === null ? target : null;
}

/** What the user reads when their own file holds our hook file's path. */
export function hookFileNotOursNotice({
  displayPath,
  command,
}: {
  displayPath: string;
  command: string;
}): string {
  return (
    `${displayPath} is not a LangWatch file, so it was left alone, and Copilot ` +
    `sessions will not report their repository or branch. Copilot loads every .json file ` +
    `in that folder: rename yours, then run \`langwatch instrument ${command}\` again.`
  );
}

/**
 * Writes the hook file of the agent `command` launches, when that file is ours
 * alone (Copilot). Null when there is none or the write failed: best-effort,
 * because the exports it rides beside are the wiring that matters.
 */
export function assertOwnedHookFileFor({
  command,
}: {
  command: string;
}): SessionContextHooksInstallResult | null {
  const tool = ownedHookFileToolForCommand(command);
  if (!tool) return null;
  try {
    return installSessionContextHooks({ tool });
  } catch {
    return null;
  }
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
  const target = resolveTarget({ tool, filePath });
  if (hasOwnedHookFile(tool)) return readOwnedHookFile({ tool, filePath: target.path }) !== null;
  const document = readAppSettingsFile(target.path);
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
  if (hasOwnedHookFile(tool)) return removeOwnedHookFile({ tool, filePath: target.path });

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

  if (!stripLangwatchEntries(hooks)) return false;

  if (Object.keys(hooks).length === 0) delete document.hooks;
  else document.hooks = hooks;

  writeAppSettingsFile({ filePath: target.path, settings: document });
  return true;
}

/** Drops our entries from every event, and any event left empty. Returns whether any went. */
function stripLangwatchEntries(hooks: Record<string, unknown>): boolean {
  let removed = false;
  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) continue;
    const kept = entries.filter((entry) => !isLangwatchHookEntry(entry));
    if (kept.length === entries.length) continue;
    removed = true;
    if (kept.length === 0) delete hooks[event];
    else hooks[event] = kept;
  }
  return removed;
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
  return entry.hooks.some((hook) => isPlainObject(hook) && isOwnedCommand(hook.command));
}

/** Whether a hook's command is one of ours. */
function isOwnedCommand(command: unknown): boolean {
  return (
    typeof command === "string" &&
    OWNED_COMMAND_PREFIXES.some((prefix) => command.startsWith(prefix))
  );
}

function resolveTarget({
  tool,
  filePath,
}: {
  tool: HookedTool;
  filePath: string | undefined;
}): HooksTarget {
  if (filePath) return { path: filePath, displayPath: filePath };
  return sessionContextHooksTarget(tool);
}

/**
 * Write the tool's own hook file. A file at our path that is not ours (see
 * `readOwnedHookFile`) is left exactly as it is and reported `not_ours`.
 */
function installOwnedHookFile({
  tool,
  target,
}: {
  tool: HookedTool;
  target: HooksTarget;
}): SessionContextHooksInstallResult {
  let existing: string | null;
  try {
    existing = fs.readFileSync(target.path, "utf8");
  } catch {
    existing = null;
  }
  if (existing !== null && readOwnedHookFile({ tool, filePath: target.path }) === null) {
    return { action: "not_ours", ...target };
  }

  const document = copilotHookFileDocument(tool);
  if (existing === `${JSON.stringify(document, null, 2)}\n`) {
    return { action: "unchanged", ...target };
  }
  writeAppSettingsFile({ filePath: target.path, settings: document });
  return { action: existing === null ? "created" : "updated", ...target };
}

/**
 * The file in Copilot's hook format: one command per event, run through
 * bash, which is how both the CLI and VS Code read a user-level hook file.
 */
function copilotHookFileDocument(tool: HookedTool): Record<string, unknown> {
  const entry = {
    type: "command",
    bash: sessionContextHookCommand(tool),
    timeoutSec: HOOK_TIMEOUT_SECONDS,
  };
  return {
    version: COPILOT_HOOK_FILE_VERSION,
    hooks: Object.fromEntries(COPILOT_HOOK_EVENTS.map((event) => [event, [entry]])),
  };
}

/** The keys an entry of ours carries, in what `copilotHookFileDocument` writes or wrote. */
const OWNED_ENTRY_KEYS: ReadonlySet<string> = new Set(["type", "bash", "timeoutSec"]);

/** The top-level keys a hook file of ours carries. */
const OWNED_FILE_KEYS: ReadonlySet<string> = new Set(["version", "hooks"]);

/**
 * The owned hook file when it holds nothing but entries running our command.
 * Running it is not enough: a user may write it beside hooks of their own,
 * which a rewrite or delete would lose. Null when missing, malformed or theirs.
 */
function readOwnedHookFile({
  tool,
  filePath,
}: {
  tool: HookedTool;
  filePath: string;
}): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
  if (!isPlainObject(parsed) || !isPlainObject(parsed.hooks)) return null;
  const onlyOurKeys = Object.keys(parsed).every((key) => OWNED_FILE_KEYS.has(key));
  if (!onlyOurKeys) return null;
  const events = Object.values(parsed.hooks);
  const command = sessionContextHookCommand(tool);
  const isOurEntry = (entry: unknown): boolean => {
    if (!isPlainObject(entry) || entry.bash !== command) return false;
    return Object.keys(entry).every((key) => OWNED_ENTRY_KEYS.has(key));
  };
  const isOnlyOurs = (entries: unknown): boolean => {
    if (!Array.isArray(entries) || entries.length === 0) return false;
    return entries.every(isOurEntry);
  };
  return events.length > 0 && events.every(isOnlyOurs) ? parsed : null;
}

/** Delete the owned hook file when it is ours. Returns whether it was removed. */
function removeOwnedHookFile({ tool, filePath }: { tool: HookedTool; filePath: string }): boolean {
  if (readOwnedHookFile({ tool, filePath }) === null) return false;
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

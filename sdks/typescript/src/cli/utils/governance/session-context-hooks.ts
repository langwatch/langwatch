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
  type OwnedHookFileTool,
  ownedHookFileToolForCommand,
  SESSION_CONTEXT_AGENTS,
  type SessionContextAgentId,
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

/**
 * Grok reads Claude Code's hook shape. SubagentStart fires in the parent with
 * the child's id, the one place a subagent's parent is known (ADR-192).
 */
const GROK_HOOK_EVENTS = ["SessionStart", "Stop", "SubagentStart"] as const;

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

/**
 * `not_ours`: a file of the user's holds our path (Copilot), so nothing was
 * written and sessions report no repository. `user_file_runs_hook`: the same,
 * but their file runs our hook command, so sessions still report it.
 */
export type SessionContextHooksAction =
  | "created"
  | "updated"
  | "unchanged"
  | "not_ours"
  | "user_file_runs_hook";

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
  agentId,
  command,
}: {
  displayPath: string;
  agentId: SessionContextAgentId;
  command: string;
}): string {
  const agent = SESSION_CONTEXT_AGENTS[agentId].displayName;
  return (
    `${displayPath} is not a LangWatch file, so it was left alone, and ${agent} ` +
    `sessions will not report their repository or branch. ${agent} loads every .json file ` +
    `in that folder: rename yours, then run \`langwatch instrument ${command}\` again.`
  );
}

/**
 * Writes the hook file of the agent `command` launches, when that file is ours
 * alone. Null when there is none or the write failed (warned on stderr):
 * best-effort, because the exports it rides beside are the wiring that matters.
 */
export function assertOwnedHookFileFor({
  command,
}: {
  command: string;
}): (SessionContextHooksInstallResult & { tool: OwnedHookFileTool }) | null {
  const tool = ownedHookFileToolForCommand(command);
  if (!tool) return null;
  try {
    return { ...installSessionContextHooks({ tool }), tool };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(
      `  ! Could not write ${sessionContextHooksTarget(tool).displayPath} (${reason}): ` +
        `sessions will not report their repository or branch.`,
    );
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
 * `readOwnedHookFile`) is left exactly as it is and reported `not_ours`, or
 * `user_file_runs_hook` when it runs our hook command itself.
 */
function installOwnedHookFile({
  tool,
  target,
}: {
  tool: HookedTool;
  target: HooksTarget;
}): SessionContextHooksInstallResult {
  const existing = readHookFileText(target.path);
  if (existing !== null && readOwnedHookFile({ tool, filePath: target.path }) === null) {
    const isRunningOurHook = fileRunsHookCommand({ tool, filePath: target.path });
    return { action: isRunningOurHook ? "user_file_runs_hook" : "not_ours", ...target };
  }

  const document = ownedHookFileDocument(tool);
  if (existing === `${JSON.stringify(document, null, 2)}\n`) {
    return { action: "unchanged", ...target };
  }
  writeAppSettingsFile({ filePath: target.path, settings: document });
  return { action: existing === null ? "created" : "updated", ...target };
}

/**
 * A hook file's text, or null when there is none. Any other read failure
 * throws, as a shared file's does: writing over a file we could not read
 * would lose whatever it holds.
 */
function readHookFileText(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw new Error(
      `Can't read ${filePath}: ${error instanceof Error ? error.message : String(error)}. ` +
        `Fix the file and run this again; writing over it would lose everything it holds.`,
    );
  }
}

function isMissingFileError(error: unknown): boolean {
  return isPlainObject(error) && error.code === "ENOENT";
}

/** The whole of our own hook file, in the format its agent reads. */
function ownedHookFileDocument(tool: HookedTool): Record<string, unknown> {
  return tool === "grok" ? grokHookFileDocument(tool) : copilotHookFileDocument(tool);
}

/** The file in Claude Code's hook shape, as Grok reads it: one matcher-less group per event. */
function grokHookFileDocument(tool: HookedTool): Record<string, unknown> {
  const group = {
    hooks: [
      { type: "command", command: sessionContextHookCommand(tool), timeout: HOOK_TIMEOUT_SECONDS },
    ],
  };
  return { hooks: Object.fromEntries(GROK_HOOK_EVENTS.map((event) => [event, [group]])) };
}

/**
 * The file in Copilot's hook format: one command per event, under `bash` for
 * macOS and Linux and `powershell` for Windows, as Copilot reads them. The
 * command is the same in both shells, as a Claude Code or Codex hook's is.
 */
function copilotHookFileDocument(tool: HookedTool): Record<string, unknown> {
  const command = sessionContextHookCommand(tool);
  const entry = {
    type: "command",
    bash: command,
    powershell: command,
    timeoutSec: HOOK_TIMEOUT_SECONDS,
  };
  return {
    version: COPILOT_HOOK_FILE_VERSION,
    hooks: Object.fromEntries(COPILOT_HOOK_EVENTS.map((event) => [event, [entry]])),
  };
}

/** The keys an entry of ours carries, in what `copilotHookFileDocument` writes or wrote. */
const OWNED_ENTRY_KEYS: ReadonlySet<string> = new Set(["type", "bash", "powershell", "timeoutSec"]);

/** The keys a handler of ours carries, in what `grokHookFileDocument` writes. */
const OWNED_HANDLER_KEYS: ReadonlySet<string> = new Set(["type", "command", "timeout"]);

/** The top-level keys a hook file of ours carries. */
const OWNED_FILE_KEYS: ReadonlySet<string> = new Set(["version", "hooks"]);

/** Grok's file carries no version: `hooks` is all of it. */
const GROK_OWNED_FILE_KEYS: ReadonlySet<string> = new Set(["hooks"]);

/** A Grok matcher group whose every handler runs our command and nothing else. */
function isOurGrokGroup({ group, command }: { group: unknown; command: string }): boolean {
  if (!isPlainObject(group)) return false;
  const hasOnlyHooks = Object.keys(group).every((key) => key === "hooks");
  if (!hasOnlyHooks || !Array.isArray(group.hooks) || group.hooks.length === 0) return false;
  return group.hooks.every((handler: unknown) => isOurHandler({ handler, command }));
}

function isOurHandler({ handler, command }: { handler: unknown; command: string }): boolean {
  if (!isPlainObject(handler) || handler.command !== command) return false;
  return Object.keys(handler).every((key) => OWNED_HANDLER_KEYS.has(key));
}

function isOurCopilotEntry({ entry, command }: { entry: unknown; command: string }): boolean {
  if (!isPlainObject(entry) || entry.bash !== command) return false;
  // A file an older CLI wrote carries no `powershell`; one that differs is the user's.
  if ("powershell" in entry && entry.powershell !== command) return false;
  return Object.keys(entry).every((key) => OWNED_ENTRY_KEYS.has(key));
}

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
  const fileKeys = tool === "grok" ? GROK_OWNED_FILE_KEYS : OWNED_FILE_KEYS;
  const hasOnlyOurKeys = Object.keys(parsed).every((key) => fileKeys.has(key));
  if (!hasOnlyOurKeys) return null;
  const events = Object.values(parsed.hooks);
  const command = sessionContextHookCommand(tool);
  const isOurEntry = (entry: unknown): boolean =>
    tool === "grok"
      ? isOurGrokGroup({ group: entry, command })
      : isOurCopilotEntry({ entry, command });
  const isOnlyOurs = (entries: unknown): boolean => {
    if (!Array.isArray(entries) || entries.length === 0) return false;
    return entries.every(isOurEntry);
  };
  return events.length > 0 && events.every(isOnlyOurs) ? parsed : null;
}

/**
 * Whether a hook file, ours or the user's, runs our hook command on some event,
 * alone or chained, which is what makes a session report its repository.
 */
function fileRunsHookCommand({ tool, filePath }: { tool: HookedTool; filePath: string }): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return false;
  }
  if (!isPlainObject(parsed) || !isPlainObject(parsed.hooks)) return false;
  const hookArgs = ["ingest", "hook", SESSION_CONTEXT_AGENTS[tool].hookArgument];
  // Copilot names the command per shell on the entry; Claude's shape nests handlers in a group.
  const commandsOf = (entry: Record<string, unknown>): unknown[] => [
    entry.bash,
    entry.powershell,
    ...(Array.isArray(entry.hooks)
      ? entry.hooks.map((handler) => (isPlainObject(handler) ? handler.command : undefined))
      : []),
  ];
  const runsCommand = (entry: unknown): boolean =>
    isPlainObject(entry) &&
    commandsOf(entry).some(
      (shellCommand) =>
        typeof shellCommand === "string" &&
        shellCommand.split(/&&|\|\||;/).some((part) => runsLangwatchWith({ part, args: hookArgs })),
    );
  return Object.values(parsed.hooks).some(
    (entries) => Array.isArray(entries) && entries.some(runsCommand),
  );
}

/** The words of one shell command, with the quotes taken off a quoted one. */
function shellWords(part: string): string[] {
  return [...part.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? "");
}

function basename(word: string): string {
  return word.split(/[\\/]/).pop() ?? "";
}

/** The npx package spec of this CLI: `langwatch` or `langwatch@<version>`, nothing else. */
const NPX_PACKAGE_RE = /^langwatch(@[^\s@/]+)?$/;

/** The CLI's entry script under its installed package, as the codex notify argv names it. */
const ENTRY_SCRIPT_RE = /[\\/]langwatch[\\/]dist[\\/]cli[\\/]index\.js$/;

/**
 * How many leading words launch this CLI in `words`: `langwatch` by name or
 * path, `npx [flags] langwatch[@v]`, or `node <entry>`. Zero when they launch
 * anything else, so `langwatch-foo` or `npx @acme/langwatch` never count.
 */
function langwatchLauncherLength(words: readonly string[]): number {
  const [first = "", ...rest] = words;
  const name = basename(first);
  if (name === "langwatch") return 1;
  if (name === "npx") {
    const at = rest.findIndex((word) => !word.startsWith("-"));
    return at !== -1 && NPX_PACKAGE_RE.test(rest[at] ?? "") ? at + 2 : 0;
  }
  if (name === "node") {
    const entry = rest[0] ?? "";
    return basename(entry) === "langwatch" || ENTRY_SCRIPT_RE.test(entry) ? 2 : 0;
  }
  return 0;
}

/** Whether one command of a chain runs this CLI with exactly `args`. */
function runsLangwatchWith({ part, args }: { part: string; args: readonly string[] }): boolean {
  const words = shellWords(part.trim());
  const launcher = langwatchLauncherLength(words);
  if (launcher === 0) return false;
  const rest = words.slice(launcher);
  return rest.length === args.length && rest.every((word, i) => word === args[i]);
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

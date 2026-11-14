/**
 * The shapes of a hook file we own whole, one per agent file format. An agent's
 * row in `SESSION_CONTEXT_AGENTS` names its format; the installer reads it there.
 */

/** How one agent reads a hook file of ours, and how we tell the file is still ours alone. */
export interface OwnedHookFileFormat {
  /** The top-level keys a file of ours carries. */
  fileKeys: ReadonlySet<string>;
  /** The whole file, running `command` on every event. */
  document: (args: { command: string; timeoutSeconds: number }) => Record<string, unknown>;
  /** Whether one entry under an event runs our command and nothing else. */
  isOurEntry: (args: { entry: unknown; command: string }) => boolean;
}

/** The only version of the Copilot hook file format there is. */
const COPILOT_HOOK_FILE_VERSION = 1;

/** Copilot's spelling of the two events: `agentStop` closes every turn as Claude's `Stop` does. */
const COPILOT_HOOK_EVENTS = ["sessionStart", "agentStop"] as const;

/** The keys an entry of ours carries, in what the Copilot document writes or wrote. */
const COPILOT_ENTRY_KEYS: ReadonlySet<string> = new Set([
  "type",
  "bash",
  "powershell",
  "timeoutSec",
]);

/**
 * Copilot's format: one command per event, under `bash` for macOS and Linux and
 * `powershell` for Windows. The command is the same in both shells.
 */
export const COPILOT_HOOK_FILE_FORMAT: OwnedHookFileFormat = {
  fileKeys: new Set(["version", "hooks"]),
  document: ({ command, timeoutSeconds }) => {
    const entry = {
      type: "command",
      bash: command,
      powershell: command,
      timeoutSec: timeoutSeconds,
    };
    return {
      version: COPILOT_HOOK_FILE_VERSION,
      hooks: Object.fromEntries(COPILOT_HOOK_EVENTS.map((event) => [event, [entry]])),
    };
  },
  isOurEntry: ({ entry, command }) => {
    if (!isPlainObject(entry) || entry.bash !== command) return false;
    // A file an older CLI wrote carries no `powershell`; one that differs is the user's.
    if ("powershell" in entry && entry.powershell !== command) return false;
    return Object.keys(entry).every((key) => COPILOT_ENTRY_KEYS.has(key));
  },
};

/**
 * Claude Code's hook shape. SubagentStart fires in the parent with the child's
 * id, the one place a Grok subagent's parent is known (ADR-192).
 */
const CLAUDE_SHAPE_HOOK_EVENTS = ["SessionStart", "Stop", "SubagentStart"] as const;

/** The keys a handler of ours carries, in what the Claude-shape document writes. */
const CLAUDE_SHAPE_HANDLER_KEYS: ReadonlySet<string> = new Set(["type", "command", "timeout"]);

/** Claude Code's format, as Grok reads it: one matcher-less group per event, no version. */
export const CLAUDE_SHAPE_HOOK_FILE_FORMAT: OwnedHookFileFormat = {
  fileKeys: new Set(["hooks"]),
  document: ({ command, timeoutSeconds }) => {
    const group = { hooks: [{ type: "command", command, timeout: timeoutSeconds }] };
    return { hooks: Object.fromEntries(CLAUDE_SHAPE_HOOK_EVENTS.map((event) => [event, [group]])) };
  },
  isOurEntry: ({ entry, command }) => {
    if (!isPlainObject(entry)) return false;
    const hasOnlyHooks = Object.keys(entry).every((key) => key === "hooks");
    if (!hasOnlyHooks || !Array.isArray(entry.hooks) || entry.hooks.length === 0) return false;
    return entry.hooks.every(
      (handler: unknown) =>
        isPlainObject(handler) &&
        handler.command === command &&
        Object.keys(handler).every((key) => CLAUDE_SHAPE_HANDLER_KEYS.has(key)),
    );
  },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * One row per coding agent whose session reports its repository through a
 * hook: the argument its hook command is called with, the agent the record
 * declares, the source types its personal ingest key is cached under, where
 * its session id and launch directory come from, and where its hook lives.
 * The hook, its install and removal, `ingest context` and the key heal all
 * read this table instead of keeping a list of their own (ADR-039 S5).
 * Spec: specs/ai-governance/cli-wrappers/session-context-hook.feature
 */

import * as os from "node:os";
import * as path from "node:path";

import { appSettingsTargetFor } from "./app-settings";
import { opencodePluginTarget } from "./opencode-plugin";

/** Where one agent's hook lives on disk. */
export interface HooksTarget {
  /** Absolute path of the hook file. */
  path: string;
  /** The same path with the home directory collapsed, for display. */
  displayPath: string;
}

/**
 * How an agent runs our hook, which decides how it is installed and removed:
 * entries merged into a hook file the user shares with us, a plugin module
 * opencode loads, or a whole file only LangWatch writes in a folder the agent
 * loads every file of.
 */
export type HookTarget =
  | { kind: "entries"; resolve: () => HooksTarget }
  | { kind: "plugin"; resolve: () => HooksTarget }
  | { kind: "owned-file"; resolve: () => HooksTarget };

export interface SessionContextAgent {
  /** The tool argument `langwatch ingest hook` is called with. */
  hookArgument: string;
  /** What the record declares as `coding_agent.name`: the server's agent id. */
  agent: string;
  /** Every source type a personal key for this agent is cached and minted under. */
  keySourceTypes: readonly string[];
  /** Which of those keys the hook running in `env` posts with. */
  keySourceType: (env: NodeJS.ProcessEnv) => string;
  /**
   * The variable carrying the session id when the payload has none. The
   * payload's own `session_id` (or `sessionId`) always wins.
   */
  sessionIdVar?: string;
  /**
   * The variable pinned to the launch directory. The payload's `cwd` beats
   * it, since it follows the session into a worktree it switches to.
   */
  projectDirVar?: string;
  hookTarget: HookTarget;
}

/** The single key source type of an agent with one surface. */
const only = (sourceType: string) => () => sourceType;

/**
 * The Copilot hook folder: `$COPILOT_HOME/hooks` when the user relocated it,
 * `~/.copilot/hooks` otherwise. Both the CLI and VS Code load every `*.json`
 * there, so this file is ours alone and no user file is ever edited.
 */
function copilotHookFile(): HooksTarget {
  const home = process.env.COPILOT_HOME?.trim();
  if (home) {
    const file = path.join(home, "hooks", COPILOT_HOOK_FILE_NAME);
    return { path: file, displayPath: file };
  }
  return {
    path: path.join(os.homedir(), ".copilot", "hooks", COPILOT_HOOK_FILE_NAME),
    displayPath: `~/.copilot/hooks/${COPILOT_HOOK_FILE_NAME}`,
  };
}

/** The name of LangWatch's own file in the Copilot hook folder. */
export const COPILOT_HOOK_FILE_NAME = "langwatch.json";

export const SESSION_CONTEXT_AGENTS = {
  claude_code: {
    hookArgument: "claude-code",
    agent: "claude_code",
    keySourceTypes: ["claude_code"],
    keySourceType: only("claude_code"),
    sessionIdVar: "CLAUDE_CODE_SESSION_ID",
    projectDirVar: "CLAUDE_PROJECT_DIR",
    hookTarget: {
      kind: "entries",
      resolve: () => {
        // app-settings owns the claude settings location, and always has one.
        const target = appSettingsTargetFor("claude")!;
        return { path: target.path, displayPath: target.displayPath };
      },
    },
  },
  codex: {
    hookArgument: "codex",
    agent: "codex",
    keySourceTypes: ["codex"],
    keySourceType: only("codex"),
    hookTarget: {
      kind: "entries",
      resolve: () => {
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
  },
  opencode: {
    hookArgument: "opencode",
    agent: "opencode",
    keySourceTypes: ["opencode"],
    keySourceType: only("opencode"),
    hookTarget: { kind: "plugin", resolve: () => opencodePluginTarget() },
  },
  copilot: {
    hookArgument: "copilot",
    agent: "copilot",
    // One agent, two surfaces, two keys: the CLI and VS Code are minted and
    // cached apart so each surface's telemetry stays separable (ADR-039 S4).
    keySourceTypes: ["copilot_cli", "copilot_vscode"],
    // The CLI marks every hook it runs with COPILOT_CLI; VS Code sets nothing.
    keySourceType: (env) => (env.COPILOT_CLI?.trim() ? "copilot_cli" : "copilot_vscode"),
    // The CLI pins this to where it was launched; VS Code sends none.
    projectDirVar: "COPILOT_PROJECT_DIR",
    hookTarget: { kind: "owned-file", resolve: copilotHookFile },
  },
} as const satisfies Record<string, SessionContextAgent>;

type AgentTable = typeof SESSION_CONTEXT_AGENTS;

/** An agent with a row in the table. */
export type SessionContextAgentId = keyof AgentTable;

/** The agents whose hook is a command in a hook file, rather than a plugin module. */
export type HookedTool = {
  [K in SessionContextAgentId]: AgentTable[K]["hookTarget"]["kind"] extends "plugin" ? never : K;
}[SessionContextAgentId];

/** Whether `slug` names an agent with a row in the table. */
export function isSessionContextAgentId(slug: string): slug is SessionContextAgentId {
  return Object.hasOwn(SESSION_CONTEXT_AGENTS, slug);
}

/**
 * The row for a tool argument or agent id, in any of its spellings
 * (`claude-code`, `claude_code`, `Claude-Code`). Null for an agent with no row.
 */
export function sessionContextAgentFor(
  tool: string,
): (SessionContextAgent & { id: SessionContextAgentId }) | null {
  const slug = tool.trim().toLowerCase().replace(/-/g, "_");
  if (!isSessionContextAgentId(slug)) return null;
  return { ...SESSION_CONTEXT_AGENTS[slug], id: slug };
}

/** The row whose personal key is cached under `sourceType`, or null. */
export function sessionContextAgentByKeySourceType(
  sourceType: string,
): (SessionContextAgent & { id: SessionContextAgentId }) | null {
  for (const [id, row] of Object.entries(SESSION_CONTEXT_AGENTS)) {
    const keySourceTypes: readonly string[] = row.keySourceTypes;
    if (keySourceTypes.includes(sourceType) && isSessionContextAgentId(id)) {
      return { ...row, id };
    }
  }
  return null;
}

/** Every agent's hook argument, for a message that lists the accepted ones. */
export function sessionContextHookArguments(): string[] {
  const rows: SessionContextAgent[] = Object.values(SESSION_CONTEXT_AGENTS);
  return rows.map((row) => row.hookArgument);
}

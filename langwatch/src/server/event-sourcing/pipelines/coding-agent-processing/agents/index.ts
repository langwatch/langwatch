import type { CodingAgentDefinition } from "./_types";
import { claudeCodeAgent } from "./claudeCode";
import { claudeCoworkAgent } from "./claudeCowork";
import { codexAgent } from "./codex";
import { copilotAgent } from "./copilot";
import { geminiCliAgent } from "./geminiCli";
import { opencodeAgent } from "./opencode";

/**
 * The agent registry — ordered, first match wins.
 *
 * Adding an agent is one definition file plus one entry here; the engine
 * (`../services/coding-agent-normalization.ts`) folds the registry into the
 * shared detection, prefix-stripping, and vocabulary tables. Nothing else
 * changes.
 *
 * Order is load-bearing in exactly one place: claude_cowork sits before
 * claude_code because Cowork reuses the Claude Code runtime (anthropic
 * scope, claude_code-namespaced names) and only its service identity
 * distinguishes it — the more specific signal must be asked first.
 */
export const CODING_AGENT_REGISTRY = [
  claudeCoworkAgent,
  claudeCodeAgent,
  opencodeAgent,
  codexAgent,
  geminiCliAgent,
  copilotAgent,
] as const satisfies readonly CodingAgentDefinition[];

/**
 * The agents whose telemetry is events-only (`logsOnly` on the definition) —
 * membership lives on the registry so adding an agent touches `agents/`
 * only; the session derivation gates its event-folding on this set.
 */
export const LOGS_ONLY_AGENT_IDS: ReadonlySet<string> = new Set(
  CODING_AGENT_REGISTRY.filter((agent) => agent.logsOnly === true).map(
    (agent) => agent.id,
  ),
);

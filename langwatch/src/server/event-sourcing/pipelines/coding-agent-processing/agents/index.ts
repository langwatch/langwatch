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
export const CODING_AGENT_REGISTRY: readonly CodingAgentDefinition[] = [
  claudeCoworkAgent,
  claudeCodeAgent,
  opencodeAgent,
  codexAgent,
  geminiCliAgent,
  copilotAgent,
];

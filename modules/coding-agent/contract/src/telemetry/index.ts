import { claudeCodeAgent } from "./claude-code.ts";
import { claudeCoworkAgent } from "./claude-cowork.ts";
import { codexAgent } from "./codex.ts";
import type { CodingAgentDefinition } from "./coding-agent-definition.ts";
import { copilotAgent } from "./copilot.ts";
import { geminiCliAgent } from "./gemini-cli.ts";
import { opencodeAgent } from "./opencode.ts";

export type {
  CodingAgent,
  CodingAgentDefinition,
  CodingAgentEvent,
  CodingAgentMetric,
  CodingAgentSignal,
  TokenType,
} from "./coding-agent-definition.ts";
export { codingAgentSchema } from "./coding-agent-definition.ts";
export { isModelCallSpan, pickString } from "./coding-agent-span.ts";

// Agent registry ordered first-match-wins; claude_cowork before claude_code
// because only service identity distinguishes them.
export const CODING_AGENT_REGISTRY = [
  claudeCoworkAgent,
  claudeCodeAgent,
  opencodeAgent,
  codexAgent,
  geminiCliAgent,
  copilotAgent,
] as const satisfies readonly CodingAgentDefinition[];

// Module-load failure on a duplicate id: `satisfies` checks each entry's
// SHAPE, not that ids are distinct. Two definitions sharing an id load fine,
// but the second becomes unreachable and `LOGS_ONLY_AGENT_IDS` silently
// collapses them — a wiring bug with no runtime symptom, caught here instead.
const duplicateAgentId = CODING_AGENT_REGISTRY.map((agent) => agent.id).find(
  (id, index, ids) => ids.indexOf(id) !== index,
);
if (duplicateAgentId !== undefined) {
  throw new Error(
    `Duplicate coding-agent id "${duplicateAgentId}" in CODING_AGENT_REGISTRY: ids must be unique, because detection is first match wins.`,
  );
}

/** Events-only agents; string-typed to handle agents this build no longer has. */
export const LOGS_ONLY_AGENT_IDS: ReadonlySet<string> = new Set(
  CODING_AGENT_REGISTRY.filter((agent) => agent.logsOnly === true).map((agent) => agent.id),
);

/**
 * Agents whose TOOL RUNS fold from `tool_result` log events — every
 * logs-only agent, plus any span-bearing agent with no tool span
 * (`foldsToolRunsFromEvents`; codex is the first). Same shape as `LOGS_ONLY_AGENT_IDS`.
 */
export const EVENTS_FOLD_TOOL_RUNS_AGENT_IDS: ReadonlySet<string> = new Set(
  CODING_AGENT_REGISTRY.filter(
    (agent) => agent.logsOnly === true || agent.foldsToolRunsFromEvents === true,
  ).map((agent) => agent.id),
);

/**
 * Per agent, tool names that are dispatch plumbing rather than actions
 * (`wrapperToolNames`): the session fold declines to count a run under one
 * of these, since every tool invoked through it reports its own `tool_result`.
 */
export const WRAPPER_TOOL_NAMES_BY_AGENT_ID: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  CODING_AGENT_REGISTRY.filter(
    (agent) => agent.wrapperToolNames !== undefined && agent.wrapperToolNames.length > 0,
  ).map((agent) => [agent.id, new Set(agent.wrapperToolNames)]),
);

/**
 * Agents whose log contributions must carry the provider session key
 * (`logsRequireSessionKey`): the dispatcher skips a keyless record of theirs
 * rather than falling back to trace, since for them that means ambient telemetry.
 */
export const LOGS_REQUIRE_SESSION_KEY_AGENT_IDS: ReadonlySet<string> = new Set(
  CODING_AGENT_REGISTRY.filter((agent) => agent.logsRequireSessionKey === true).map(
    (agent) => agent.id,
  ),
);

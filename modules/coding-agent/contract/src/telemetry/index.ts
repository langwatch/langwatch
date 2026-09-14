import type { CodingAgentDefinition } from "./coding-agent-definition.ts";
import { claudeCodeAgent } from "./claude-code.ts";
import { claudeCoworkAgent } from "./claude-cowork.ts";
import { codexAgent } from "./codex.ts";
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
export { isModelCallSpan, readString } from "./coding-agent-span.ts";

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

// Module-load failure on a duplicate id, matching the guard `mergeAliasTables`
// already applies to aliases. `satisfies` checks each entry's SHAPE, not that
// the ids are distinct: two definitions declaring the same id load fine, the
// second becomes permanently unreachable under first-match-wins, and
// `LOGS_ONLY_AGENT_IDS` silently collapses them — so a logs-only agent could
// take a non-logs-only agent's fold path, or the reverse. That is a wiring bug
// with no runtime symptom, which is exactly what belongs at load time.
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
 * The agents whose TOOL RUNS fold from their `tool_result` log events —
 * every logs-only agent, plus any span-bearing agent that simply has no tool
 * span (`foldsToolRunsFromEvents` on the definition; codex is the first).
 * Same string-typed shape and reasoning as {@link LOGS_ONLY_AGENT_IDS}.
 */
export const EVENTS_FOLD_TOOL_RUNS_AGENT_IDS: ReadonlySet<string> = new Set(
  CODING_AGENT_REGISTRY.filter(
    (agent) => agent.logsOnly === true || agent.foldsToolRunsFromEvents === true,
  ).map((agent) => agent.id),
);

/**
 * Per agent, the tool names that are dispatch plumbing rather than actions
 * (`wrapperToolNames` on the definition): the session fold declines to count
 * a tool run under one of these, because every tool invoked through it
 * reports its own `tool_result`. Keyed by the same string-typed contribution
 * agent as the sets above.
 */
export const WRAPPER_TOOL_NAMES_BY_AGENT_ID: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  CODING_AGENT_REGISTRY.filter(
    (agent) => agent.wrapperToolNames !== undefined && agent.wrapperToolNames.length > 0,
  ).map((agent) => [agent.id, new Set(agent.wrapperToolNames)]),
);

/**
 * The agents whose log contributions must carry the provider session key
 * (`logsRequireSessionKey` on the definition): the log dispatcher skips a
 * record of theirs that has none instead of falling back to the record's
 * trace, because for them a keyless record is ambient process telemetry.
 * Same string-typed shape and reasoning as {@link LOGS_ONLY_AGENT_IDS}.
 */
export const LOGS_REQUIRE_SESSION_KEY_AGENT_IDS: ReadonlySet<string> = new Set(
  CODING_AGENT_REGISTRY.filter((agent) => agent.logsRequireSessionKey === true).map(
    (agent) => agent.id,
  ),
);

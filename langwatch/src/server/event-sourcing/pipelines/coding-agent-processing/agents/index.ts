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

/**
 * The agents whose telemetry is events-only (`logsOnly` on the definition) —
 * membership lives on the registry so adding an agent touches `agents/`
 * only; the session derivation gates its event-folding on this set.
 *
 * Typed `ReadonlySet<string>`, not `ReadonlySet<CodingAgent>`, deliberately.
 * What gets tested against it is the `agent` on a stored contribution, which
 * is `z.string().min(1)` because it is decoded from a durable event and may
 * name an agent this build's union no longer has (or does not yet have).
 * Narrowing the set would push a cast onto that boundary, which is the one
 * place the looser type is load-bearing. The ids themselves are still checked
 * — each definition satisfies `CodingAgentDefinition`, whose `id` IS the
 * union, and the duplicate guard above closes the gap `satisfies` leaves.
 */
export const LOGS_ONLY_AGENT_IDS: ReadonlySet<string> = new Set(
  CODING_AGENT_REGISTRY.filter((agent) => agent.logsOnly === true).map(
    (agent) => agent.id,
  ),
);

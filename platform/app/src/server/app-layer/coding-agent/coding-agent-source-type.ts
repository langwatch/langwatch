/**
 * The ingestion `sourceType` an agent's telemetry arrives under.
 *
 * Two vocabularies meet here. A stored session's `agent` is a coding-agent
 * registry id (`CODING_AGENT_REGISTRY`, detected from the wire's own scope and
 * event names). The bundled-plan policy is keyed on the ingestion key's
 * `sourceType`, which is the tool slug an admin's coding-assistant tile carries
 * as `assistantKind`. The two agree on `claude_code`, `codex` and `opencode`,
 * and differ on two: the registry says `gemini_cli` where the tile says
 * `gemini`, and `copilot` where the tile says `github_copilot`.
 *
 * `claude_cowork` is deliberately mapped to itself rather than folded into
 * `claude_code`: it is its own ingestion source type, and there is no tile to
 * untick for it, so it resolves to the bundled default on its own name.
 *
 * An agent with no entry passes through unchanged. That is the honest answer
 * for an agent this build's registry does not know: the policy either finds a
 * tile under that exact slug or applies its own default.
 */
const SOURCE_TYPE_BY_AGENT: Readonly<Record<string, string>> = {
  gemini_cli: "gemini",
  copilot: "github_copilot",
};

export function ingestSourceTypeOfAgent(agent: string): string {
  return SOURCE_TYPE_BY_AGENT[agent] ?? agent;
}

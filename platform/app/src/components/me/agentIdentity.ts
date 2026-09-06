import type { AssistantKind } from "./tiles/assistantIcons";

/**
 * The product an agent slug names.
 *
 * A stored session's `agent` is a coding-agent registry id, detected from the
 * wire's own scope and event names. The icons and labels a reader sees are
 * keyed on assistant kinds, the vocabulary the coding-assistant tiles use. The
 * two agree on most names and differ on two: the registry says `gemini_cli`
 * where the tile says `gemini`, and `copilot` where the tile says
 * `github_copilot`.
 */
const ASSISTANT_KIND_BY_AGENT = {
  claude_code: "claude_code",
  claude_cowork: "claude_cowork",
  codex: "codex",
  gemini: "gemini",
  gemini_cli: "gemini",
  opencode: "opencode",
  cursor: "cursor",
  github_copilot: "github_copilot",
  copilot: "github_copilot",
} as const satisfies Record<string, Exclude<AssistantKind, "custom">>;

/**
 * The assistant kind a slug resolves to, or null when this build does not know
 * the agent. A caller that gets null shows the raw slug rather than inventing
 * an icon for something it cannot name.
 */
export function assistantKindOfAgent(
  agent: string,
): Exclude<AssistantKind, "custom"> | null {
  const slug = agent.trim();
  if (slug.length === 0) return null;
  return (
    ASSISTANT_KIND_BY_AGENT[slug as keyof typeof ASSISTANT_KIND_BY_AGENT] ??
    null
  );
}

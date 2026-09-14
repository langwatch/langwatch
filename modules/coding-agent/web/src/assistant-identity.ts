/** The assistant names the coding-agent UI knows how to render. */
export type KnownAssistantKind =
  | "claude_code"
  | "claude_cowork"
  | "codex"
  | "gemini"
  | "opencode"
  | "cursor"
  | "github_copilot";

// Maps agent registry ids (detected from wire) to tile assistant kinds;
// most agree except gemini_cli→gemini and copilot→github_copilot.
const ASSISTANT_KIND_BY_AGENT: Readonly<Record<string, KnownAssistantKind>> = {
  claude_code: "claude_code",
  claude_cowork: "claude_cowork",
  codex: "codex",
  gemini: "gemini",
  gemini_cli: "gemini",
  opencode: "opencode",
  cursor: "cursor",
  github_copilot: "github_copilot",
  copilot: "github_copilot",
};

/**
 * The assistant kind a slug resolves to, or null when this build does not know
 * the agent. A caller that gets null shows the raw slug rather than inventing
 * an icon for something it cannot name.
 */
export function assistantKindOfAgent(agent: string): KnownAssistantKind | null {
  const slug = agent.trim();
  if (slug.length === 0) return null;
  return ASSISTANT_KIND_BY_AGENT[slug] ?? null;
}

export const CODING_AGENTS = ["claude", "codex", "copilot", "gemini", "opencode"];

/** Signed steps from the chosen agent, wrapped so the wheel shows two either side. */
export function wheelOffset({ index, chosen }: { index: number; chosen: number }) {
  const count = CODING_AGENTS.length;
  return ((((index - chosen) % count) + count + 2) % count) - 2;
}

/**
 * Per-turn system prompt: persona + turn `system` block + AGENTS.md last,
 * since the model weighs the prompt's end most. Direct assignment does NOT
 * survive `prompt()`; a `before_agent_start` handler returns it from a holder instead.
 */

export type SystemPromptParts = {
  personaPrompt: string;
  agentsMd: string;
  turnSystem?: string;
};

export function composeSystemPrompt({
  personaPrompt,
  agentsMd,
  turnSystem,
}: SystemPromptParts): string {
  const sections = [personaPrompt, turnSystem, agentsMd]
    .map((section) => section?.trim() ?? "")
    .filter((section) => section.length > 0);
  return sections.join("\n\n");
}

/**
 * A resume seed (handoff digest from a previous worker) is prepended to the
 * turn prompt, clearly labeled so the model reads it as context, not as the
 * user's words.
 */
export function prependResumeSeed({ prompt, seed }: { prompt: string; seed: string }): string {
  return [
    "[Resumed conversation: digest of the previous worker's session. Newest messages last; the oldest may be truncated.]",
    seed,
    "[End of digest. The user's current message follows.]",
    "",
    prompt,
  ].join("\n");
}

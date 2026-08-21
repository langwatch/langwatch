/**
 * Per-turn system prompt composition: persona + AGENTS.md + the turn's
 * `system` block, in that order.
 *
 * Mechanism (measured against pi 0.84.2 internals, verified against captured
 * provider requests): direct assignment to `session.agent.state.systemPrompt`
 * does NOT survive a prompt: `AgentSession.prompt()` resets it to the base
 * prompt on every call unless an extension's `before_agent_start` handler
 * returns `{ systemPrompt }` ("Replace the system prompt for this turn", the
 * documented extension contract). So the wrapper registers a tiny inline
 * extension whose handler returns the current composition from a mutable
 * holder (see session.ts); the runner updates the holder before each prompt.
 * Cheapest correct option: no resource loader reload, no session recreation.
 * The DefaultResourceLoader's `systemPromptOverride` seeds the same
 * composition at construction so pi's default coding prompt is never active.
 */

export type SystemPromptParts = {
  personaPrompt: string;
  agentsMd: string;
  turnSystem?: string;
};

export function composeSystemPrompt({ personaPrompt, agentsMd, turnSystem }: SystemPromptParts): string {
  const sections = [personaPrompt, agentsMd, turnSystem]
    .map((section) => section?.trim() ?? "")
    .filter((section) => section.length > 0);
  return sections.join("\n\n");
}

/**
 * A resume seed (handoff digest from a previous worker) is prepended to the
 * turn prompt, clearly labeled so the model reads it as context, not as the
 * user's words.
 */
export function prependResumeSeed(prompt: string, seed: string): string {
  return [
    "[Resumed conversation: digest of the previous worker's session. Newest messages last; the oldest may be truncated.]",
    seed,
    "[End of digest. The user's current message follows.]",
    "",
    prompt,
  ].join("\n");
}

/** Stable registry handles for Langy's versioned prompts. */
export const LANGY_PROMPT_HANDLES = {
  agentDefinition: "langy-agent-definition",
  turnOverride: "langy-turn-override",
} as const;

export type LangyPromptHandle =
  (typeof LANGY_PROMPT_HANDLES)[keyof typeof LANGY_PROMPT_HANDLES];

/** The production tag is opt-in; an absent registry row keeps the fallback. */
export const LANGY_PROMPT_DEFAULT_TAG = "production";

/** The in-repository fallback for the per-turn system override. */
export const LANGY_TURN_OVERRIDE_FALLBACK = [
  "You are Langy, the in-product LangWatch assistant.",
  "AGENTS.md is your operating contract and applies to every reply.",
  "Facts about the user's project come from what you retrieve this turn, never from memory.",
  "End on the answer: no closing question or next-actions menu (AGENTS.md names the exceptions).",
].join(" ");

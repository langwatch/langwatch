/**
 * The copy every voice-agent refusal shows the customer (AC29), plus the
 * flag key itself. Kept in a module with no imports at all — client-bundled
 * code (suites/errors.ts via suite-evaluators, TalkToItPanel) reads it
 * directly, so it must never pull in server runtime.
 */
export const VOICE_AGENTS_FLAG_KEY = "release_voice_agents_enabled" as const;

export const VOICE_AGENTS_DISABLED_MESSAGE =
  "Voice agents are not enabled for this project";

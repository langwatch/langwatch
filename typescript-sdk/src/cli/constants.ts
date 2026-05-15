/**
 * Default model written into a freshly created `.prompt.yaml`.
 *
 * Kept in lock-step with the platform's server-side DEFAULT_MODEL
 * (langwatch/src/utils/constants.ts) so a prompt created from the CLI starts
 * on the same current flagship the platform would assign on sync. Must be a
 * modern model — never a legacy gpt-4 generation.
 */
export const DEFAULT_PROMPT_MODEL = "openai/gpt-5.5";

/**
 * The few values the journey and the setup that boots its stack both need.
 */

/**
 * The model every leg that names one uses. Set on the stack the suite boots as
 * `LANGWATCH_DEFAULT_MODEL`, which is what decides the model a simulation's
 * user simulator and judge fall back to when neither is overridden.
 */
export const JOURNEY_MODEL_ID = "openai/gpt-5-mini";

/** The reason a leg that needs a live model provider is skipped. */
export const NO_MODEL_PROVIDER_KEY = "OPENAI_API_KEY not set";

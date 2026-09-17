/** Chat-transcript presentation: ChatGPT-style thread vs side bubbles. */
export type ChatLayout = "thread" | "bubbles";

/**
 * Above this turn count `ConversationTurnsList` switches into virtualized
 * mode. Below it the inline render is cheaper than spinning up a scroll
 * container + measureElement refs.
 */
export const VIRTUALIZE_AT = 8;

/**
 * Above this turn count we collapse everything except the last turn by
 * default — short convos still benefit from showing the last couple
 * expanded; long convos drown the user in collapsed noise unless we're
 * aggressive about hiding.
 */
export const LONG_THREAD_THRESHOLD = 6;

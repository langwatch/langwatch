/** Names reserved for credentials managed by LangWatch itself. */
export const LANGY_SESSION_API_KEY_NAME = "Langy session";

/**
 * System-managed keys are hidden from customer listings and cannot be
 * addressed by customer mutation/read paths.
 */
export const HIDDEN_SYSTEM_KEY_NAMES: readonly string[] = [LANGY_SESSION_API_KEY_NAME];

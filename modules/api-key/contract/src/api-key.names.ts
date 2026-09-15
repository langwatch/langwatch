/** Names reserved for credentials managed by LangWatch itself. */
export const LANGY_SESSION_API_KEY_NAME = "Langy session";

/**
 * Name of the short-lived key put in a code agent's sandbox. One is minted per
 * run and expires by itself, so the same listing rule as the Langy session key
 * applies.
 */
export const AGENT_SANDBOX_API_KEY_NAME = "Agent sandbox run";

/**
 * Name prefix of the key a `langwatch login` device session carries. The
 * device label follows it, so a re-login from the same device finds the key
 * it replaces by (prefix, label), and the hourly sweep over elapsed login
 * keys finds its rows by the prefix alone. NOT a hidden name: a customer can
 * name a key this way, so it is not in `HIDDEN_SYSTEM_KEY_NAMES`.
 */
export const CLI_LOGIN_KEY_NAME_PREFIX = "CLI login - ";

// System-managed keys hidden from customers; also a tenant-isolation boundary.
// Add names only when no customer row can carry them—every create/rename must refuse non-system
// callers.
export const HIDDEN_SYSTEM_KEY_NAMES: readonly string[] = [
  LANGY_SESSION_API_KEY_NAME,
  AGENT_SANDBOX_API_KEY_NAME,
];

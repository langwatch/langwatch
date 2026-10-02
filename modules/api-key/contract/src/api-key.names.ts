/** Names reserved for credentials managed by LangWatch itself. */
export const LANGY_SESSION_API_KEY_NAME = "Langy session";

/**
 * Name of the short-lived key put in a code agent's sandbox. One is minted per
 * run and expires by itself, so the same listing rule as the Langy session key
 * applies.
 */
export const AGENT_SANDBOX_API_KEY_NAME = "Agent sandbox run";

/**
 * Name of the key minted for one workflow run's calls back into LangWatch. It acts as the user
 * who started the run and expires by itself, so the same listing rule as the Langy key applies.
 */
export const WORKFLOW_RUN_API_KEY_NAME = "Workflow run";

/**
 * Name of the ownerless key a gateway trace project's spans are exported with. It holds only
 * `traces:create`, never expires and is replaced only when the gateway rotates it.
 */
export const TRACE_EXPORT_API_KEY_NAME = "Gateway trace export";

/**
 * Name prefix of the key a `langwatch login` device session carries,
 * matched with the device label for re-login replacement and by the hourly
 * sweep alone. NOT hidden: a customer can name a key this way too.
 */
export const CLI_LOGIN_KEY_NAME_PREFIX = "CLI login - ";

// Names only the system ever minted under, so a row carrying one is hidden even if it predates the
// stored `isSystemManaged` mark. Never add a name a customer row could already carry.
export const HIDDEN_SYSTEM_KEY_NAMES: readonly string[] = [
  LANGY_SESSION_API_KEY_NAME,
  AGENT_SANDBOX_API_KEY_NAME,
];

/** Names a customer may not give a new key; existing customer keys under them stay theirs. */
export const RESERVED_SYSTEM_KEY_NAMES: readonly string[] = [
  ...HIDDEN_SYSTEM_KEY_NAMES,
  WORKFLOW_RUN_API_KEY_NAME,
  TRACE_EXPORT_API_KEY_NAME,
];

/** A key LangWatch minted for itself: hidden from listings and never updated or revoked by hand. */
export function isSystemApiKey(key: {
  name: string;
  isSystemManaged?: boolean | undefined;
}): boolean {
  return key.isSystemManaged === true || HIDDEN_SYSTEM_KEY_NAMES.includes(key.name);
}

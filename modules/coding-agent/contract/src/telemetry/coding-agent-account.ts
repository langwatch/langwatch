/**
 * The subscription account a coding agent ran on. A launcher (or the agent itself) stamps these
 * on each record, or once on the resource through `OTEL_RESOURCE_ATTRIBUTES`; the record wins.
 * @see specs/coding-agent/account-usage.feature
 */

/** An opaque id for the account; never an email address. */
export const ACCOUNT_ID_ATTRIBUTE = "langwatch.account.id";
/** The label the account's owner gave it, such as "Work Max". */
export const ACCOUNT_NAME_ATTRIBUTE = "langwatch.account.name";
/** Where the login comes from: `personal`, `pool` or `computer`. */
export const ACCOUNT_SOURCE_ATTRIBUTE = "langwatch.account.source";
/** The provider's own usage figure for the tightest window, 0 to 100. */
export const ACCOUNT_USAGE_PERCENT_ATTRIBUTE = "langwatch.account.usage.percent";
/** When that window resets, as an ISO 8601 instant. */
export const ACCOUNT_USAGE_RESETS_AT_ATTRIBUTE = "langwatch.account.usage.resets_at";
/** When the launcher read the figure, as an ISO 8601 instant. */
export const ACCOUNT_USAGE_READ_AT_ATTRIBUTE = "langwatch.account.usage.read_at";
/** Which window the figure is for, such as `five_hour` or `seven_day`. */
export const ACCOUNT_USAGE_WINDOW_ATTRIBUTE = "langwatch.account.usage.window";
/** Set while the account is out of usage: when it can run again, as an ISO 8601 instant. */
export const ACCOUNT_LIMITED_UNTIL_ATTRIBUTE = "langwatch.account.limited_until";

/** Every account attribute the session facts lift. */
export const CODING_AGENT_ACCOUNT_KEYS: readonly string[] = [
  ACCOUNT_ID_ATTRIBUTE,
  ACCOUNT_NAME_ATTRIBUTE,
  ACCOUNT_SOURCE_ATTRIBUTE,
  ACCOUNT_USAGE_PERCENT_ATTRIBUTE,
  ACCOUNT_USAGE_RESETS_AT_ATTRIBUTE,
  ACCOUNT_USAGE_READ_AT_ATTRIBUTE,
  ACCOUNT_USAGE_WINDOW_ATTRIBUTE,
  ACCOUNT_LIMITED_UNTIL_ATTRIBUTE,
];

/** The agents' own account ids, used as the account key when no launcher names one. */
export const AGENT_ACCOUNT_ID_KEYS: readonly string[] = ["user.account_uuid", "user.account_id"];

/** The account facts a resource carries, for the keys the record itself left unset. */
export function resourceAccountFacts({
  facts,
  resourceAttributes,
}: {
  facts: Readonly<Record<string, string | number | boolean>>;
  resourceAttributes: Readonly<Record<string, unknown>> | null;
}): Record<string, string | number> {
  const lifted: Record<string, string | number> = {};
  if (resourceAttributes === null) return lifted;
  for (const key of [...CODING_AGENT_ACCOUNT_KEYS, ...AGENT_ACCOUNT_ID_KEYS]) {
    if (facts[key] !== undefined) continue;
    const value = resourceAttributes[key];
    if (typeof value === "string" && value.trim() !== "") lifted[key] = value;
    else if (typeof value === "number" && Number.isFinite(value)) lifted[key] = value;
  }
  return lifted;
}

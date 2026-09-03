/** Names reserved for credentials managed by LangWatch itself. */
export const LANGY_SESSION_API_KEY_NAME = "Langy session";

/**
 * Name of the short-lived key put in a code agent's sandbox. One is minted per
 * run and expires by itself, so the same listing rule as the Langy session key
 * applies.
 */
export const AGENT_SANDBOX_API_KEY_NAME = "Agent sandbox run";

/**
 * System-managed keys are hidden from customer listings and cannot be
 * addressed by customer mutation/read paths.
 *
 * THIS IS ALSO A TENANT-ISOLATION BOUNDARY, not merely a UI filter. Membership
 * here grants a cross-tenant query bound in `guardOrganizationId`
 * (`platform/app/src/utils/dbOrganizationIdProtection.ts`): a maintenance sweep
 * over ApiKey rows naming one of these runs WITHOUT an `organizationId`,
 * because a reserved name can only ever reach platform-minted rows.
 *
 * A name may therefore be added only when no customer row can already carry
 * it — every create and rename path must refuse it for non-system callers,
 * keyed on this same list. `readonly` so no call site can mutate the array into
 * something that widens that bound.
 */
export const HIDDEN_SYSTEM_KEY_NAMES: readonly string[] = [
  LANGY_SESSION_API_KEY_NAME,
  AGENT_SANDBOX_API_KEY_NAME,
];

/**
 * Reserved API-key names for system-managed keys, plus the set that must be
 * hidden from the user-facing API-keys list.
 *
 * Leaf module (no imports) so both the api-key repository AND the Langy service
 * that mints these keys can depend on it without creating a dependency cycle
 * (langy → api-key service → api-key repository; the repository must not import
 * back up into langy).
 */

/**
 * Name of the ephemeral, per-chat-session Langy key minted by
 * `mintLangySessionApiKey`. One is created per Langy chat session and
 * auto-expires, so they would otherwise pile up and clutter the API-keys UI —
 * they are filtered out of every listing (see HIDDEN_SYSTEM_KEY_NAMES).
 */
export const LANGY_SESSION_API_KEY_NAME = "Langy session";

/**
 * Name of the short-lived key `mintAgentSandboxApiKey` puts in a code agent's
 * sandbox. One is created per run and auto-expires, so the same listing rule
 * as the Langy session key applies (see HIDDEN_SYSTEM_KEY_NAMES).
 */
export const AGENT_SANDBOX_API_KEY_NAME = "Agent sandbox run";

/**
 * Keys with these names are system-managed and short-lived; they are excluded
 * from both the per-user and the admin (org-wide) API-keys listings so the UI
 * shows only keys a human created and manages. They remain fully functional for
 * auth (verify/revoke go by id/lookupId, not by these list queries).
 *
 * THIS IS ALSO A TENANT-ISOLATION BOUNDARY, not just a UI filter. Membership
 * here grants a cross-tenant query bound in `guardOrganizationId`
 * (`utils/dbOrganizationIdProtection.ts`): an ApiKey sweep naming one of these
 * runs WITHOUT an organizationId, because a reserved name can only reach
 * platform-minted rows. A name may therefore be added only when no customer row
 * can already carry it — every create and rename path must refuse it for
 * non-system callers (`ApiKeyService.create` / `.update` do, keyed on this same
 * list). `readonly` so the array cannot be mutated at a call site into
 * something that widens that bound.
 */
export const HIDDEN_SYSTEM_KEY_NAMES: readonly string[] = [
  LANGY_SESSION_API_KEY_NAME,
  AGENT_SANDBOX_API_KEY_NAME,
];

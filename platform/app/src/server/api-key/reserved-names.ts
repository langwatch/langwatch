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
 * Keys with these names are system-managed and short-lived; they are excluded
 * from both the per-user and the admin (org-wide) API-keys listings so the UI
 * shows only keys a human created and manages. They remain fully functional for
 * auth (verify/revoke go by id/lookupId, not by these list queries).
 */
export const HIDDEN_SYSTEM_KEY_NAMES: string[] = [LANGY_SESSION_API_KEY_NAME];

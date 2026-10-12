/**
 * The rollout flag Langy access hangs off, and the only lever that opens it. Shared by
 * the server-side decision (`hasLangyAccess`) and the client visibility hook
 * (`useShowLangy`) so the two can never drift onto different keys.
 */
export const LANGY_RELEASE_FLAG = "release_langy_enabled" as const;

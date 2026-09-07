/**
 * The rollout flag Langy access hangs off, and the only lever that opens it.
 * Shared by the server-side decision (`hasLangyAccess`) and the client
 * visibility hook (`useShowLangy`) so the two can never drift onto different
 * keys. Registered in the feature-flag registry with `defaultValue: false`, so
 * Langy is dark everywhere until the flag is explicitly turned on for a
 * project, an organization, or a user.
 */
export const LANGY_RELEASE_FLAG = "release_langy_enabled" as const;

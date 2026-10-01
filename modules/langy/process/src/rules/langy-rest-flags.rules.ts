/**
 * `LANGY_UI_ACTIONS_FLAG` lives in `app/langy.members.ts`, beside
 * `LangyUiActionSurface` — its adapter may not import this transport file.
 */

/** `/api/langy/conversations` — the project-API-key turn surface. */
export const LANGY_API_KEY_TURNS_FLAG = "release_langy_api_key_turns_enabled" as const;

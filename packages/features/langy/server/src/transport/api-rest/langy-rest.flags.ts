/**
 * The two rollout flags the public Langy doors are dark behind.
 *
 * Declared rather than imported, for the same reason
 * {@link LANGY_RELEASE_FLAG} is: the key is the flag registry's identifier and
 * the registry is what pins every reader to it. Each defaults to false, so
 * both surfaces answer Hono's own 404 until an operator opens them for a
 * project.
 */

/** `/api/langy/conversations` — the project-API-key turn surface. */
export const LANGY_API_KEY_TURNS_FLAG = "release_langy_api_key_turns_enabled" as const;

/** `/api/langy/ui/actions` — the agent-to-page dispatch surface. */
export const LANGY_UI_ACTIONS_FLAG = "release_langy_ui_actions" as const;

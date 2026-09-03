import { usePublicEnv } from "./use-public-env";

/** The flag these screens roll out on. */
export const IDENTITY_FRONT_DOOR_FLAG = "release_ui_identity_front_door_enabled" as const;

/**
 * Whether the identifier-first screens are the front door for THIS visitor
 * (ADR-117 §7).
 *
 * The deployment answers, through `IDENTITY_ROUTER_V2` reaching the browser as
 * a derived boolean on the public environment.
 *
 * It cannot use `useFeatureFlag`, and that is the whole reason this hook
 * exists: every screen it governs is reached BEFORE there is a session, and
 * `featureFlag.isEnabled` is a protected procedure that answers 401 rather
 * than false to a signed-out visitor. There is no per-browser override any
 * more — the local override store and the drawer that wrote it were removed
 * when feature flags were wired through the app — so the deployment is the
 * only answer.
 *
 * `isResolved` stays separate from `enabled`: until the deployment has
 * answered, neither door may render, because guessing would flash the wrong
 * one on every load.
 */
export function useIdentityFrontDoor(): {
  enabled: boolean;
  isResolved: boolean;
} {
  const publicEnv = usePublicEnv();

  return {
    enabled: publicEnv.data?.IDENTITY_FRONT_DOOR === true,
    isResolved: publicEnv.data !== undefined,
  };
}

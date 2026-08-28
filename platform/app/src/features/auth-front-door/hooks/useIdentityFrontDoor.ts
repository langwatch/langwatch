import { useFeatureFlagOverrides } from "~/hooks/useFeatureFlagOverrides";
import { usePublicEnv } from "~/hooks/usePublicEnv";

/** The flag these screens roll out on. */
export const IDENTITY_FRONT_DOOR_FLAG =
  "release_ui_identity_front_door_enabled" as const;

/**
 * Whether the identifier-first screens are the front door for THIS visitor
 * (ADR-117 §7).
 *
 * This browser's override wins; otherwise the deployment answers, through
 * `IDENTITY_ROUTER_V2` reaching the browser as a derived boolean.
 *
 * It cannot use `useFeatureFlag`, and that is the whole reason this hook
 * exists: every screen it governs is reached BEFORE there is a session, and
 * `featureFlag.isEnabled` is a protected procedure that answers 401 rather
 * than false to a signed-out visitor. `?ff_release_ui_identity_front_door_enabled=on`
 * is the handle that replaces it — remembered per browser, so it survives the
 * redirect back from an identity provider, and undone with `=clear`.
 *
 * `isResolved` stays separate from `enabled`: until the deployment has
 * answered, neither door may render, because guessing would flash the wrong
 * one on every load. An override answers immediately and waits for nothing.
 */
export function useIdentityFrontDoor(): {
  enabled: boolean;
  isResolved: boolean;
} {
  const publicEnv = usePublicEnv();
  const override = useFeatureFlagOverrides()[IDENTITY_FRONT_DOOR_FLAG];

  if (override !== undefined) return { enabled: override, isResolved: true };

  return {
    enabled: publicEnv.data?.IDENTITY_FRONT_DOOR === true,
    isResolved: publicEnv.data !== undefined,
  };
}

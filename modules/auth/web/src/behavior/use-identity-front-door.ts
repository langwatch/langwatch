import { usePublicEnv } from "./use-public-env.ts";

/** The flag these screens roll out on. */
export const IDENTITY_FRONT_DOOR_FLAG = "release_ui_identity_front_door_enabled" as const;

/**
 * Identifier-first front door flag; isResolved separate from enabled to prevent flashing
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

import { usePublicEnv } from "~/hooks/usePublicEnv";

/**
 * Whether the identifier-first screens are the front door on this deployment
 * (ADR-117 §7). One flag covers the router and the screens; the browser only
 * ever learns the derived answer, and only ever for `enforce` — the router
 * also runs in shadow, and screens never render then.
 *
 * `isResolved` is separate from `enabled` on purpose: until the deployment has
 * answered, neither door may render. Guessing would flash the legacy screen at
 * an enforced deployment on every load.
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

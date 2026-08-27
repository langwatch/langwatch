import { usePublicEnv } from "~/hooks/usePublicEnv";
import { useIdentityAuthScreens } from "./useIdentityAuthScreens";

/**
 * Whether a passkey minted on this deployment is a way IN on this deployment
 * — the browser's read of `deploymentSignsInWithPasskeys()`
 * (`server/app-layer/identity/signin-method-policy.ts`).
 *
 * The same two facts, from the same two settings, composed the same way: the
 * plugin has to be mounted (`PASSKEYS_ENABLED`) AND the identifier-first
 * screens have to be the auth screens (`IDENTITY_FRONT_DOOR`, which is
 * `IDENTITY_ROUTER_V2 === "enforce"`). The legacy screens accept no passkey,
 * so a deployment still signing everybody in the old way must not be allowed
 * to OFFER one — that is a credential minted for a door with no button on it.
 *
 * Anything that offers to create a passkey asks this; anything that merely
 * USES one somebody already has asks `PASSKEYS_ENABLED` on its own.
 *
 * `isResolved` is carried through for the same reason the auth-screen hook
 * carries it: until the deployment has answered, an offer would flash in and
 * out of a card that has not decided what it is.
 */
export function useSignsInWithPasskeys(): {
  enabled: boolean;
  isResolved: boolean;
} {
  const publicEnv = usePublicEnv();
  const auth = useIdentityAuthScreens();

  return {
    enabled: auth.enabled && publicEnv.data?.PASSKEYS_ENABLED === true,
    isResolved: auth.isResolved && publicEnv.data !== undefined,
  };
}

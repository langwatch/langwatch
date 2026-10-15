/**
 * The passkey, two-step and linking ceremonies auth lends by token: the better-auth
 * client stays auth's, and this workspace's host calls through.
 * ARCHITECTURE.md §10.1 "A name another module depends on is a token from its owner".
 */

import {
  PasskeyCeremoniesToken,
  SignInMethodLinkingToken,
  TwoStepCeremoniesToken,
} from "@langwatch/auth-contract";
import { useLentOperations } from "@langwatch/browser-host/lent";
import { useMemo } from "react";

export function useLentAuthCeremonies() {
  const passkeys = useLentOperations(PasskeyCeremoniesToken);
  const twoStepVerification = useLentOperations(TwoStepCeremoniesToken);
  const signInMethodLinking = useLentOperations(SignInMethodLinkingToken);
  return useMemo(
    () => ({ passkeys, twoStepVerification, signInMethodLinking }),
    [passkeys, twoStepVerification, signInMethodLinking],
  );
}

/** What auth lent; absent is what a composition without auth reads. */
export type LentAuthCeremonies = ReturnType<typeof useLentAuthCeremonies>;

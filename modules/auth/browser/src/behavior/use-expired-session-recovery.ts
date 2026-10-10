import type { RoutingDecision } from "@langwatch/identity-contract";
import { useEffect, useRef } from "react";

import { authApi as api } from "./auth-api.ts";

/**
 * The address an expired session of this browser's names, handed to the router
 * once exactly as a typed one would be. Never over an address already in play,
 * and a failed ask leaves the cold screen standing. specs/auth/expired-session-recovery.feature
 */
export function useExpiredSessionRecovery({
  signedIn,
  identifierInPlay,
  decide,
  breakGlass,
}: {
  signedIn: boolean;
  identifierInPlay: string | null;
  decide: (input: {
    identifier: string | null;
    breakGlass?: boolean;
  }) => Promise<RoutingDecision | null>;
  breakGlass: boolean;
}): string | null {
  const priorSession = api.auth.priorSession.useQuery(undefined, {
    enabled: !signedIn,
    staleTime: Infinity,
    retry: false,
  });
  const recoveredEmail = priorSession.data?.kind === "expired" ? priorSession.data.email : null;
  const recoveryAsked = useRef(false);

  useEffect(() => {
    if (recoveryAsked.current || signedIn) return;
    if (!recoveredEmail || identifierInPlay) return;
    recoveryAsked.current = true;
    void decide({ identifier: recoveredEmail, breakGlass });
  }, [recoveredEmail, signedIn, identifierInPlay, decide, breakGlass]);

  return recoveredEmail;
}

import type { RoutingDecision, SignInMethod } from "@langwatch/identity";
import { useEffect, useRef, useState } from "react";
import { signIn } from "~/utils/auth-client";
import {
  readLastUsedMethodId,
  rememberLastUsedMethod,
} from "../logic/lastUsedMethod";

/**
 * What this instance offers before an address is in hand, and the way to take
 * one of them.
 *
 * The router is asked once, on mount, with no identifier at all: the answer is
 * the method set both front-door screens show beside their address field, so
 * neither screen decides for itself what an instance offers. `skip` is
 * whatever makes the question moot — a session already in hand, a confirmation
 * link being spent — and stops it being asked at all.
 */
export function useFrontDoorMethods({
  decide,
  callbackUrl,
  skip,
  breakGlass = false,
}: {
  decide: (input: {
    identifier: string | null;
    breakGlass?: boolean;
  }) => Promise<RoutingDecision | null>;
  /** Where a federated method brings the browser back to. */
  callbackUrl: string | undefined;
  /** Truthy when there is nothing to ask, so nothing is asked. */
  skip: unknown;
  breakGlass?: boolean;
}): {
  /** What the instance offers with no address in hand. */
  instanceMethods: readonly SignInMethod[];
  /** The method this browser signed in with last, null when there is none. */
  lastUsedMethodId: string | null;
  /** Takes a federated method, remembering it on the way out. */
  dialFederated: (method: SignInMethod) => void;
} {
  const [instanceMethods, setInstanceMethods] = useState<
    readonly SignInMethod[]
  >([]);
  const [lastUsedMethodId] = useState(() => readLastUsedMethodId());
  const askedOnMount = useRef(false);

  useEffect(() => {
    if (askedOnMount.current || skip) return;
    askedOnMount.current = true;
    void decide({ identifier: null, breakGlass }).then((decision) => {
      if (decision?.outcome === "method_picker") {
        setInstanceMethods(decision.methodSet);
      }
    });
  }, [decide, skip, breakGlass]);

  const dialFederated = (method: SignInMethod) => {
    rememberLastUsedMethod(method);
    void signIn(method.id, { callbackUrl });
  };

  return { instanceMethods, lastUsedMethodId, dialFederated };
}

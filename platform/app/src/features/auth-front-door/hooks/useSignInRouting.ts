import type { RoutingDecision } from "@langwatch/identity";
import { useCallback, useState } from "react";
import { api } from "~/utils/api";

/**
 * The screens' one link to the router (ADR-117 §6): an address goes out, a
 * decision comes back, and the screen renders it. No routing lives here —
 * this hook does not read the decision it carries, and could not branch on it
 * if it wanted to.
 */
export function useSignInRouting(): {
  decision: RoutingDecision | null;
  /** The address the decision was made for, null before one was submitted. */
  identifier: string | null;
  decide: (input: {
    identifier: string | null;
    breakGlass?: boolean;
  }) => Promise<RoutingDecision | null>;
  /** Back to the address step, keeping nothing. */
  clear: () => void;
  isDeciding: boolean;
  error: unknown;
} {
  const route = api.frontDoor.route.useMutation();
  const [decision, setDecision] = useState<RoutingDecision | null>(null);
  const [identifier, setIdentifier] = useState<string | null>(null);

  const decide = useCallback(
    async ({
      identifier: submitted,
      breakGlass = false,
    }: {
      identifier: string | null;
      breakGlass?: boolean;
    }) => {
      try {
        const answered = await route.mutateAsync({
          identifier: submitted,
          breakGlass,
        });
        setDecision(answered);
        setIdentifier(submitted);
        return answered;
      } catch {
        // The failure is on the mutation, which the screen renders through the
        // error registry. Swallowed here so a routing outage cannot take the
        // screen down with it.
        return null;
      }
    },
    [route],
  );

  const clear = useCallback(() => {
    setDecision(null);
    setIdentifier(null);
  }, []);

  return {
    decision,
    identifier,
    decide,
    clear,
    isDeciding: route.isPending,
    error: route.error,
  };
}

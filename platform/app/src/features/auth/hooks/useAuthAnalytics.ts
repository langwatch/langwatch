import { useEffect, useRef } from "react";
import { useAnalytics } from "react-contextual-analytics";
import { AUTH_ACTION } from "../logic/authAnalytics";

/**
 * Reporting a step of the sign-in or sign-up screen as somebody reaches it.
 *
 * These screens are ONE route that morphs through many states — the address,
 * a method rail, a WebAuthn prompt, "check your email" — so a page-view event
 * counts the whole funnel as a single screen and the drop-off between its
 * steps is invisible. That is the number that matters here, so the STEP is
 * what gets reported, and the route is the boundary it reports inside.
 *
 * Told once, from the same state the returns branch on, which is the same
 * discipline `usePublishAuthStage` follows for the ground: two readers of
 * one value can disagree about nothing.
 *
 * Fires on the way IN to each step and only when the step actually changes, so
 * a re-render (a keystroke in the address field, a mutation settling) does not
 * report a second view of a step nobody moved to.
 */
export function usePublishAuthStep({
  surface,
  step,
  attributes,
}: {
  /** The screen, from `AUTH_SURFACE`. */
  surface: string;
  /** Which of its states is drawn, from `SIGN_IN_STEP` / `SIGN_UP_STEP`. */
  step: string;
  /** Anything that describes the step WITHOUT identifying the person. */
  attributes?: Record<string, unknown>;
}): void {
  const { emit } = useAnalytics();
  // The emitter is rebuilt on every render, so holding it in a ref is what
  // keeps it out of the effect's dependencies — otherwise the effect reruns
  // every render and reports the same step over and over.
  const emitRef = useRef(emit);
  emitRef.current = emit;
  const attributesRef = useRef(attributes);
  attributesRef.current = attributes;

  useEffect(() => {
    emitRef.current("viewed", step, {
      surface,
      ...attributesRef.current,
    });
  }, [surface, step]);
}

/**
 * The actions these screens report, bound to one surface so no call site has
 * to remember to name it.
 *
 * Returned as a stable object of functions rather than a raw `emit`, so what
 * can be reported from these screens is a list somebody can read — and so an
 * address cannot be passed to one by accident: none of these takes a string
 * that could hold one.
 */
export function useAuthAnalytics(surface: string): {
  submitted: (object: string, attributes?: Record<string, unknown>) => void;
  chose: (methodId: string) => void;
  refused: (object: string, code: string | null) => void;
  signedIn: (methodId: string) => void;
  accountCreated: (methodId: string) => void;
  linkSent: (object: string) => void;
  linkConfirmed: (attributes?: Record<string, unknown>) => void;
  ceremonyStarted: (purpose: string) => void;
  ceremonyDismissed: (purpose: string) => void;
} {
  const { emit } = useAnalytics();
  const emitRef = useRef(emit);
  emitRef.current = emit;
  // Built once. These land in effects and callbacks, and an object rebuilt
  // every render would make every one of them a changing dependency.
  const bound = useRef({
    submitted: (object: string, attributes?: Record<string, unknown>) =>
      emitRef.current(AUTH_ACTION.submitted, object, {
        surface,
        ...attributes,
      }),
    chose: (methodId: string) =>
      emitRef.current(AUTH_ACTION.chose, "method", { surface, methodId }),
    refused: (object: string, code: string | null) =>
      // The stable code, never the message: the message is copy and will
      // change, and a dashboard grouping by prose regroups itself the next
      // time somebody rewords an error.
      emitRef.current(AUTH_ACTION.refused, object, { surface, code }),
    signedIn: (methodId: string) =>
      emitRef.current(AUTH_ACTION.signedIn, "session", { surface, methodId }),
    accountCreated: (methodId: string) =>
      emitRef.current(AUTH_ACTION.accountCreated, "account", {
        surface,
        methodId,
      }),
    linkSent: (object: string) =>
      emitRef.current(AUTH_ACTION.linkSent, object, { surface }),
    linkConfirmed: (attributes?: Record<string, unknown>) =>
      emitRef.current(AUTH_ACTION.linkConfirmed, "address", {
        surface,
        ...attributes,
      }),
    ceremonyStarted: (purpose: string) =>
      emitRef.current(AUTH_ACTION.ceremonyStarted, "passkey", {
        surface,
        purpose,
      }),
    ceremonyDismissed: (purpose: string) =>
      emitRef.current(AUTH_ACTION.ceremonyDismissed, "passkey", {
        surface,
        purpose,
      }),
  });

  return bound.current;
}

import type { InstantEvalRoutePayload } from "./useInstantEvalRoute";

/**
 * The way into the search bar's Instant Eval route from outside the bar.
 *
 * The route's confirm dialog and refusal popover are anchored to the search
 * bar, so there is one route per page and the bar owns it. A caller that is
 * not the bar (the Langy `explorer.runInstantEval` action) asks through here,
 * and gets the same cost rule, the same dialog and the same progress bar a
 * typed sentence gets.
 */
type RouteHandler = (payload: InstantEvalRoutePayload) => void;

let current: RouteHandler | null = null;

/** Called by the search bar while it is mounted. Returns the unregister. */
export function registerInstantEvalRoute(handler: RouteHandler): () => void {
  current = handler;
  return () => {
    if (current === handler) current = null;
  };
}

/** Hands a payload to the mounted route. False when no search bar is there. */
export function requestInstantEvalRoute(
  payload: InstantEvalRoutePayload,
): boolean {
  if (!current) return false;
  current(payload);
  return true;
}

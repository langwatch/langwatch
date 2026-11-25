import type { InstantEvalRoutePayload } from "../../model/instant-eval-route.ts";

/**
 * The way into the search bar's Instant Eval route from outside the bar. The route's dialog
 * and refusal popover are anchored to the bar, so the bar owns the one route per page and
 * Langy's `explorer.runInstantEval` asks through here, under the same cost rule.
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
export function requestInstantEvalRoute(payload: InstantEvalRoutePayload): boolean {
  if (!current) return false;
  current(payload);
  return true;
}

import type { EvaluatorOverlayRequest } from "@langwatch/evaluator-web/screens/evaluators";

/**
 * How an overlay this family does not own is addressed: `drawer.open` plus
 * one param per prop. The three overlays it names are `platform/app`-mounted
 * chrome this application doesn't yet supply — a recorded gap, not a bug.
 */
export function overlayQuery(request: EvaluatorOverlayRequest): Record<string, string | undefined> {
  return {
    "drawer.open": request.drawer,
    ...Object.fromEntries(
      Object.entries(request.params ?? {}).map(([key, value]) => [`drawer.${key}`, value]),
    ),
  };
}

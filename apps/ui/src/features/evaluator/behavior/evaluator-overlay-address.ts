import type { EvaluatorOverlayRequest } from "@langwatch/evaluator-web/screens/evaluators";

/**
 * How an overlay this family does not own is addressed.
 *
 * `platform/app`'s drawer registry reads `drawer.open` plus one query parameter
 * per prop, which is what `openDrawer(key, props)` wrote. Spelling it once,
 * here, is what keeps the convention out of a screen.
 *
 * THE CHROME GAP IS THIS SIDE'S, and it is recorded rather than papered over.
 * `evaluatorEditor`, `codeEvaluatorEditor` and `evaluatorCategorySelector` are
 * registered in `platform/app` and mounted by `DashboardPageBody`, which is
 * application chrome a screen served from `apps/ui` has nothing above it to
 * supply. So the address changes and nothing opens, exactly as the
 * coding-agent, me, automations, annotations and analytics families recorded
 * for the same registry. The address is still the right thing to write: it is
 * what makes the overlay come back for free when the chrome layout route
 * lands, and it is what a shared link already means.
 */
export function overlayQuery(
  request: EvaluatorOverlayRequest,
): Record<string, string | undefined> {
  return {
    "drawer.open": request.drawer,
    ...Object.fromEntries(
      Object.entries(request.params ?? {}).map(([key, value]) => [`drawer.${key}`, value]),
    ),
  };
}

/**
 * Experiments: list, workbench, legacy result view and the retired
 * wizard's forward, in `@langwatch/experiment-web`. NO API binding of its
 * own — reads go through the workflow family's already-installed client.
 */

import { lazyDrawer, type UiDrawerRegistry } from "@langwatch/ui-drawer";

import { experimentPageLoaders } from "./ui/sections/experiment-routes";

/**
 * `targetTypeSelector` is what Evaluations v3's "+" and Run Evaluation
 * open; `comparisonLeaderboard` is the leaderboard card's expand. Lazy, so
 * the workflow host stays out of the bundle until one opens.
 */
export const experimentDrawers: UiDrawerRegistry = {
  comparisonLeaderboard: lazyDrawer({
    factory: () => import("./ui/sections/experiment-drawers"),
    key: "ComparisonLeaderboardDrawer",
  }),
  targetTypeSelector: lazyDrawer({
    factory: () => import("./ui/sections/experiment-drawers"),
    key: "TargetTypeSelectorDrawer",
  }),
};

export { experimentPageLoaders };

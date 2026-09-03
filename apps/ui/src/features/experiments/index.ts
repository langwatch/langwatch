/**
 * The Experiments family, as this application composes it.
 *
 * The list, the workbench, the legacy result view and the retired wizard's
 * forward live in `@langwatch/experiment-web`; what belongs to the application
 * is everything they are not allowed to own — which page key each address
 * answers, the permission policy in front of the list, and which host is
 * mounted above them.
 *
 * NO API BINDING OF ITS OWN, and that absence is the design: every read this
 * family makes goes through `@langwatch/workflow-web/studio-host/api`, which is
 * the workflow family's client and is already installed. Adding a second
 * binding for the same procedures would mount a second tRPC client over the
 * same cache keys, which is exactly what the shared-cache rule exists to avoid.
 */

import { lazyDrawer, type UiDrawerRegistry } from "@langwatch/ui-drawer";

import { experimentPageLoaders } from "./ui/sections/experiment-routes";

/**
 * The drawers this family serves, by the name the address uses.
 *
 * BOTH CAME BACK FROM `platform/app`. `targetTypeSelector` is what the
 * Evaluations v3 table's "+" and the Run Evaluation button open — with it gone,
 * the one affordance that adds anything to an evaluation opened nothing — and
 * `comparisonLeaderboard` is what the leaderboard card's expand affordance
 * opens. Their components live in `@langwatch/experiment-web/drawers`; the lazy
 * import keeps them and the workflow host out of the bundle until a reader opens
 * one.
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

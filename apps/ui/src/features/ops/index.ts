/**
 * The Ops family, as this application composes it.
 *
 * The fourteen screens and everything they render live in `@langwatch/ops-web`;
 * what belongs to the application is everything they are not allowed to own —
 * which page key each address answers, the permission policy in front of it,
 * the transport their hooks run on, and the host port that turns this
 * application's capabilities into the questions the family asks.
 *
 * IT SERVES ONE DRAWER AS WELL AS ITS SCREENS. The command palette opens the
 * Foundry beside whatever an operator is diagnosing; the page was registered
 * and the drawer was not, so that entry opened nothing.
 */

import { opsApi } from "@langwatch/ops-web/screens/ops";
import { lazyDrawer, type UiDrawerRegistry } from "@langwatch/ui-drawer";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { opsPageLoaders } from "./ui/sections/ops-routes";

export const opsApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/ops-web",
  api: opsApi,
});

/** The drawers this family serves, by the name the address uses. */
export const opsDrawers: UiDrawerRegistry = {
  foundry: lazyDrawer({
    factory: () => import("./ui/sections/ops-drawers"),
    key: "FoundryDrawer",
  }),
};

export { opsPageLoaders };

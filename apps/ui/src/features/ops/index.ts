/**
 * Ops: fourteen screens in `@langwatch/ops-web`. Serves one drawer,
 * `foundry`, opened beside whatever an operator is diagnosing from the
 * command palette.
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

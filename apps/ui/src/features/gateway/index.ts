/**
 * The AI Gateway: screens in `@langwatch/gateway-web`. Serves one drawer,
 * `routingPolicy` — a virtual key's detail page links to it by name.
 */

import { gatewayApi } from "@langwatch/gateway-web/screens/gateway";
import { lazyDrawer, type UiDrawerRegistry } from "@langwatch/ui-drawer";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { gatewayPageLoaders } from "./ui/sections/gateway-routes";

export const gatewayApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/gateway-web",
  api: gatewayApi,
});

/** The drawers this family serves, by the name the address uses. */
export const gatewayDrawers: UiDrawerRegistry = {
  routingPolicy: lazyDrawer({
    factory: () => import("./ui/sections/gateway-drawers"),
    key: "RoutingPolicyDrawer",
  }),
};

export { gatewayPageLoaders };

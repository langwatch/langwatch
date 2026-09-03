/**
 * The AI Gateway, as this application composes it.
 *
 * The screens live in `@langwatch/gateway-web`; what belongs to the application
 * is everything the screens are not allowed to own — which page key each
 * answers, the flag and permission policy in front of them, the transport their
 * hooks run on, and the host port that turns this application's capabilities
 * into the questions the section asks.
 *
 * IT SERVES ONE DRAWER AS WELL AS ITS SCREENS. A virtual key's detail page
 * links to the routing policy that key routes through by drawer name, and that
 * link opened nothing until the name was registered.
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

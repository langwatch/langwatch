/**
 * The AI Gateway: screens in `@langwatch/gateway-web`. Serves one drawer,
 * `routingPolicy` — a virtual key's detail page links to it by name.
 */

import { gatewayApi } from "@langwatch/gateway-web/screens/gateway";
import { lazyDrawer } from "@langwatch/ui-drawer";
import { uiFeature } from "../../behavior/ui-feature";
import { gatewayPageLoaders } from "./ui/sections/gateway-routes";

export const gatewayFeature = uiFeature({
  name: "@langwatch/gateway-web",
  api: gatewayApi,
  loaders: gatewayPageLoaders,
  /** The drawers this family serves, by the name the address uses. */
  drawers: {
    routingPolicy: lazyDrawer({
      factory: () => import("./ui/sections/gateway-drawers"),
      key: "RoutingPolicyDrawer",
    }),
  },
});

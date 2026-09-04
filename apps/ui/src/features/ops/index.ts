/**
 * Ops: fourteen screens in `@langwatch/ops-web`. Serves one drawer,
 * `foundry`, opened beside whatever an operator is diagnosing from the
 * command palette.
 */

import { opsApi } from "@langwatch/ops-web/screens/ops";
import { lazyDrawer } from "@langwatch/ui-drawer";
import { uiFeature } from "../../behavior/ui-feature";
import { opsPageLoaders } from "./ui/sections/ops-routes";

export const opsFeature = uiFeature({
  name: "@langwatch/ops-web",
  api: opsApi,
  loaders: opsPageLoaders,
  /** The drawers this family serves, by the name the address uses. */
  drawers: {
    foundry: lazyDrawer({
      factory: () => import("./ui/sections/ops-drawers"),
      key: "FoundryDrawer",
    }),
  },
});

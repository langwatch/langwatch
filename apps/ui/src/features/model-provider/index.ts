/** Model Provider settings: two screens in `@langwatch/model-provider-web`. */

import { modelProviderApi } from "@langwatch/model-provider-web/screens/model-provider";
import { lazyDrawer } from "@langwatch/ui-drawer";
import { uiFeature } from "../../behavior/ui-feature";
import { modelProviderPageLoaders } from "./ui/sections/model-provider-routes";

export const modelProviderFeature = uiFeature({
  name: "@langwatch/model-provider-web",
  api: modelProviderApi,
  loaders: modelProviderPageLoaders,
  /**
   * `defaultModelOverride` and `llmModelCost` open from the Default Models
   * and Model Costs tables; `editModelProvider` adds or edits a credential —
   * without it, no model surface in the product works on a fresh org.
   */
  drawers: {
    defaultModelOverride: lazyDrawer({
      factory: () => import("./ui/sections/model-provider-drawers"),
      key: "DefaultModelOverrideDrawer",
    }),
    editModelProvider: lazyDrawer({
      factory: () => import("./ui/sections/model-provider-drawers"),
      key: "EditModelProviderDrawer",
    }),
    llmModelCost: lazyDrawer({
      factory: () => import("./ui/sections/model-provider-drawers"),
      key: "LLMModelCostDrawer",
    }),
  },
});

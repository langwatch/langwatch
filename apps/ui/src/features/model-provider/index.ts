/** Model Provider settings: two screens in `@langwatch/model-provider-web`. */

import { modelProviderApi } from "@langwatch/model-provider-web/screens/model-provider";
import { lazyDrawer } from "@langwatch/ui-drawer";
import { uiFeature } from "../../behavior/ui-feature";
import { modelProviderFailures } from "./behavior/model-provider-failures";
import { modelProviderPageLoaders } from "./ui/sections/model-provider-routes";

export const modelProviderFeature = uiFeature({
  name: "@langwatch/model-provider-web",
  api: modelProviderApi,
  /**
   * A model that resolves nowhere is a refusal every AI surface can hit, so it
   * is answered here once rather than by each screen that trips it.
   */
  failures: modelProviderFailures,
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

export { modelProviderUiSlots } from "./ui/sections/model-provider-slots";

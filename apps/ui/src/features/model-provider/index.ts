/** Model Provider settings: two screens in `@langwatch/model-provider-web`. */

import { modelProviderApi } from "@langwatch/model-provider-web/screens/model-provider";
import { lazyDrawer, type UiDrawerRegistry } from "@langwatch/ui-drawer";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { modelProviderPageLoaders } from "./ui/sections/model-provider-routes";

export const modelProviderApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/model-provider-web",
  api: modelProviderApi,
});

/**
 * `defaultModelOverride` and `llmModelCost` open from the Default Models
 * and Model Costs tables; `editModelProvider` adds or edits a credential —
 * without it, no model surface in the product works on a fresh org.
 */
export const modelProviderDrawers: UiDrawerRegistry = {
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
};

export { modelProviderPageLoaders };

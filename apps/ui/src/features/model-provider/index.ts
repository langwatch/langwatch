/**
 * The Model Provider settings family, as this application composes it.
 *
 * The two screens live in `@langwatch/model-provider-web`; what belongs to the
 * application is everything they are not allowed to own — which page keys the
 * addresses answer, the settings chrome around them, the transport their hooks
 * run on, and the host port that turns this application's capabilities into the
 * questions the family asks.
 */

import { modelProviderApi } from "@langwatch/model-provider-web/screens/model-provider";
import { lazyDrawer, type UiDrawerRegistry } from "@langwatch/ui-drawer";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { modelProviderPageLoaders } from "./ui/sections/model-provider-routes";

export const modelProviderApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/model-provider-web",
  api: modelProviderApi,
});

/**
 * The drawers this family serves, by the name the address uses.
 *
 * ALL THREE RECOVERED FROM `platform/app`, deleted in `cc91631cd8`. The Model Costs
 * table's Add, Edit and Clone all write `?drawer.open=llmModelCost`, and so
 * does the trace drawer's "this model has no cost mapping" suggestion; the
 * Default Models table's "+ Add config" and every row's Edit write
 * `?drawer.open=defaultModelOverride`. Every one of them changed the URL and
 * opened nothing, which meant a customer could neither author a cost rule nor
 * configure a default model — and, through `editModelProvider`, could not add
 * or edit a credential at all, which is the one that made every other model
 * surface in the product unusable on a fresh organization.
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

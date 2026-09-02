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
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { modelProviderPageLoaders } from "./ui/sections/model-provider-routes";

export const modelProviderApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/model-provider-web",
  api: modelProviderApi,
});

export { modelProviderPageLoaders };

/** The Langy dock: panel, composer, capability cards, tool activity and context chips, all in `@langwatch/langy-web`. */

import { langyApi } from "@langwatch/langy-web/screens/langy-layout";

import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { langyPageLoaders } from "./ui/sections/langy-routes";

export const langyApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/langy-web",
  api: langyApi,
});

export { langyPageLoaders };

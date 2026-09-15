/** Langy dock: panel, composer, capability cards, tool activity, and context chips in
 * `@langwatch/langy-web`. */

import { langyApi } from "@langwatch/langy-web/langy";
import { uiFeature } from "../../behavior/ui-feature";
import { langyPageLoaders } from "./ui/sections/langy-routes";

export { langyUiSlots } from "./ui/sections/langy-slots";

export const langyFeature = uiFeature({
  name: "@langwatch/langy-web",
  api: langyApi,
  loaders: langyPageLoaders,
});

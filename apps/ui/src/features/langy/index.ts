/** The Langy dock: panel, composer, capability cards, tool activity and context chips, all in `@langwatch/langy-web`. */

import { langyApi } from "@langwatch/langy-web/screens/langy-layout";
import { uiFeature } from "../../behavior/ui-feature";
import { langyPageLoaders } from "./ui/sections/langy-routes";

export const langyFeature = uiFeature({
  name: "@langwatch/langy-web",
  api: langyApi,
  loaders: langyPageLoaders,
});

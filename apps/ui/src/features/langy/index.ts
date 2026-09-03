/**
 * The Langy family, as this application composes it.
 *
 * The dock — the panel, the composer, the capability cards, the tool activity
 * and the context chips — lives in `@langwatch/langy-web`; what belongs to the
 * application is everything it is not allowed to own: which layout key the
 * route table names, the transport its hooks run on, the vanilla client its
 * chat transport drives one turn from, and the host port that turns this
 * application's capabilities into the questions the dock asks.
 */

import { langyApi } from "@langwatch/langy-web/screens/langy-layout";

import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { langyPageLoaders } from "./ui/sections/langy-routes";

export const langyApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/langy-web",
  api: langyApi,
});

export { langyPageLoaders };

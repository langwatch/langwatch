/**
 * The project Secrets settings family, as this application composes it.
 *
 * The screen lives in `@langwatch/secret-web`; what belongs to the application
 * is which page key the address answers, the settings chrome around it, the
 * transport its hooks run on, and the host port that turns this application's
 * capabilities into the questions the screen asks.
 */

import { secretApi } from "@langwatch/secret-web/screens/secret";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { secretPageLoaders } from "./ui/sections/secret-routes";

export const secretApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/secret-web",
  api: secretApi,
});

export { secretPageLoaders };

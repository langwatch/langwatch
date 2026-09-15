/**
 * The application chrome: one layout route drawing the whole shell
 * (`@langwatch/navigation-web`'s) above every page this package serves —
 * host chrome shared by every family, so no feature web package may own it.
 */

import { uiFeature } from "../../behavior/ui-feature";
import { chromePageLoaders } from "./ui/sections/chrome-routes";

export const chromeFeature = uiFeature({
  name: "@langwatch/ui/features/chrome",
  loaders: chromePageLoaders,
});

/** Data Privacy: screen and its rule drawer, both in `@langwatch/data-privacy-web`. */

import { dataPrivacyApi } from "@langwatch/data-privacy-web/screens/data-privacy";
import { uiFeature } from "../../behavior/ui-feature";
import { dataPrivacyPageLoaders } from "./ui/sections/data-privacy-routes";

export const dataPrivacyFeature = uiFeature({
  name: "@langwatch/data-privacy-web",
  api: dataPrivacyApi,
  loaders: dataPrivacyPageLoaders,
});

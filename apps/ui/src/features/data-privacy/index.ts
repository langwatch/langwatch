/** Data Privacy: screen and its rule drawer, both in `@langwatch/data-privacy-web`. */

import { dataPrivacyApi } from "@langwatch/data-privacy-web/screens/data-privacy";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { dataPrivacyPageLoaders } from "./ui/sections/data-privacy-routes";

export const dataPrivacyApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/data-privacy-web",
  api: dataPrivacyApi,
});

export { dataPrivacyPageLoaders };

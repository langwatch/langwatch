/**
 * The Data Privacy family, as this application composes it.
 *
 * The screen and its rule drawer live in `@langwatch/data-privacy-web`; what
 * belongs to the application is everything they are not allowed to own — the
 * page key, the permission policy, the settings chrome, the transport and the
 * host port.
 */

import { dataPrivacyApi } from "@langwatch/data-privacy-web/screens/data-privacy";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { dataPrivacyPageLoaders } from "./ui/sections/data-privacy-routes";

export const dataPrivacyApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/data-privacy-web",
  api: dataPrivacyApi,
});

export { dataPrivacyPageLoaders };

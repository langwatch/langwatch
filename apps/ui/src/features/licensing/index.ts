/**
 * License: screen in `@langwatch/enterprise-licensing-web` — same
 * `enterprise-direction` finding as billing and scim
 * (`ui-family-move-manifests.md`).
 */

import { licensingApi } from "@langwatch/enterprise-licensing-web/screens/license";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { licensingPageLoaders } from "./ui/sections/licensing-routes";

export const licensingApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/enterprise-licensing-web",
  api: licensingApi,
});

export { licensingPageLoaders };

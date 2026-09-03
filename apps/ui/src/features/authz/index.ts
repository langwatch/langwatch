/** RBAC settings: two screens in `@langwatch/authz-web`. */

import { authzApi } from "@langwatch/authz-web/screens/authz";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { authzPageLoaders } from "./ui/sections/authz-routes";

export const authzApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/authz-web",
  api: authzApi,
});

export { authzPageLoaders };

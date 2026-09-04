/** RBAC settings: two screens in `@langwatch/authz-web`. */

import { authzApi } from "@langwatch/authz-web/screens/authz";
import { uiFeature } from "../../behavior/ui-feature";
import { authzPageLoaders } from "./ui/sections/authz-routes";

export const authzFeature = uiFeature({
  name: "@langwatch/authz-web",
  api: authzApi,
  loaders: authzPageLoaders,
});

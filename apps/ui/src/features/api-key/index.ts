/**
 * API Key: two screens in `@langwatch/api-key-web`, plus the CLI
 * device-flow wire the published `langwatch` binary is on the other side of.
 */

import { apiKeyApi } from "@langwatch/api-key-web/screens/api-key";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { apiKeyPageLoaders } from "./ui/sections/api-key-routes";

export const apiKeyApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/api-key-web",
  api: apiKeyApi,
});

export { apiKeyPageLoaders };

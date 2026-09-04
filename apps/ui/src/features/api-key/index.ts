/**
 * API Key: two screens in `@langwatch/api-key-web`, plus the CLI
 * device-flow wire the published `langwatch` binary is on the other side of.
 */

import { apiKeyApi } from "@langwatch/api-key-web/screens/api-key";
import { uiFeature } from "../../behavior/ui-feature";
import { apiKeyPageLoaders } from "./ui/sections/api-key-routes";

export const apiKeyFeature = uiFeature({
  name: "@langwatch/api-key-web",
  api: apiKeyApi,
  loaders: apiKeyPageLoaders,
});

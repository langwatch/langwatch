/** AI Governance: screens in `@langwatch/enterprise-governance-web`. */

import { governanceApi } from "@langwatch/enterprise-governance-web/screens/governance";
import { uiFeature } from "../../behavior/ui-feature";
import { governancePageLoaders } from "./ui/sections/governance-routes";

export const governanceFeature = uiFeature({
  name: "@langwatch/enterprise-governance-web",
  api: governanceApi,
  loaders: governancePageLoaders,
});

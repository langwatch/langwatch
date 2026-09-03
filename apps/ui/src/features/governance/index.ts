/** AI Governance: screens in `@langwatch/enterprise-governance-web`. */

import { governanceApi } from "@langwatch/enterprise-governance-web/screens/governance";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { governancePageLoaders } from "./ui/sections/governance-routes";

export const governanceApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/enterprise-governance-web",
  api: governanceApi,
});

export { governancePageLoaders };

/**
 * Billing: three screens in `@langwatch/enterprise-billing-web` — same
 * `enterprise-direction` finding as licensing and scim
 * (`ui-family-move-manifests.md`).
 */

import { billingApi } from "@langwatch/enterprise-billing-web/screens/billing";
import { uiFeature } from "../../behavior/ui-feature";
import { billingPageLoaders } from "./ui/sections/billing-routes";

export const billingFeature = uiFeature({
  name: "@langwatch/enterprise-billing-web",
  api: billingApi,
  loaders: billingPageLoaders,
});

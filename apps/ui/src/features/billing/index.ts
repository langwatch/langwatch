/**
 * Billing: three screens in `@langwatch/enterprise-billing-web` — same
 * `enterprise-direction` finding as licensing and scim
 * (`ui-family-move-manifests.md`).
 */

import { billingApi } from "@langwatch/enterprise-billing-web/screens/billing";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { billingPageLoaders } from "./ui/sections/billing-routes";

export const billingApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/enterprise-billing-web",
  api: billingApi,
});

export { billingPageLoaders };

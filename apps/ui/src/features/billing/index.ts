/**
 * The Billing family, as this application composes it.
 *
 * The three screens live in `@langwatch/enterprise-billing-web`; what belongs
 * to the application is the page keys, the permission policies, the settings
 * chrome, the transport, and the host port that turns this application's
 * capabilities into the questions the screens ask.
 *
 * THE ENTERPRISE EDGE IS REAL AND RECORDED. `apps/ui` is a core package and
 * this is an enterprise one, so the `enterprise-direction` finding the
 * governance, gateway and RBAC families already carry applies here too. It
 * clears when `packages/enterprise/composition/ui` exists.
 */

import { billingApi } from "@langwatch/enterprise-billing-web/screens/billing";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { billingPageLoaders } from "./ui/sections/billing-routes";

export const billingApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/enterprise-billing-web",
  api: billingApi,
});

export { billingPageLoaders };

/**
 * The License family, as this application composes it.
 *
 * The screen lives in `@langwatch/enterprise-licensing-web`; what belongs to
 * the application is the page key, the settings chrome, the transport, and the
 * host port that turns this application's capabilities into the questions the
 * screen asks.
 *
 * THE ENTERPRISE EDGE IS REAL AND RECORDED. `apps/ui` is a core package and
 * this is an enterprise one, so the `enterprise-direction` finding the
 * governance, gateway and RBAC families already carry applies to this import
 * too. It clears when `packages/enterprise/composition/ui` exists.
 */

import { licensingApi } from "@langwatch/enterprise-licensing-web/screens/license";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { licensingPageLoaders } from "./ui/sections/licensing-routes";

export const licensingApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/enterprise-licensing-web",
  api: licensingApi,
});

export { licensingPageLoaders };

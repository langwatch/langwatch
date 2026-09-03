/**
 * The SCIM family, as this application composes it.
 *
 * The screen lives in `@langwatch/enterprise-scim-web`; what belongs to the
 * application is the page key, the permission policy, the settings chrome, the
 * transport, and the host port that turns this application's capabilities into
 * the questions the screen asks.
 *
 * THE ENTERPRISE EDGE IS REAL AND RECORDED, as it is for the billing and
 * licensing families next door. It clears when
 * `packages/enterprise/composition/ui` exists.
 */

import { scimApi } from "@langwatch/enterprise-scim-web/screens/scim";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { scimPageLoaders } from "./ui/sections/scim-routes";

export const scimApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/enterprise-scim-web",
  api: scimApi,
});

export { scimPageLoaders };

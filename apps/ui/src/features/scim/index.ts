/**
 * SCIM: screen in `@langwatch/enterprise-scim-web` — same enterprise edge
 * as billing and licensing (`ui-family-move-manifests.md`).
 */

import { scimApi } from "@langwatch/enterprise-scim-web/screens/scim";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { scimPageLoaders } from "./ui/sections/scim-routes";

export const scimApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/enterprise-scim-web",
  api: scimApi,
});

export { scimPageLoaders };

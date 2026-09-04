/**
 * SCIM: screen in `@langwatch/enterprise-scim-web` — same enterprise edge
 * as billing and licensing (`ui-family-move-manifests.md`).
 */

import { scimApi } from "@langwatch/enterprise-scim-web/screens/scim";
import { uiFeature } from "../../behavior/ui-feature";
import { scimPageLoaders } from "./ui/sections/scim-routes";

export const scimFeature = uiFeature({
  name: "@langwatch/enterprise-scim-web",
  api: scimApi,
  loaders: scimPageLoaders,
});

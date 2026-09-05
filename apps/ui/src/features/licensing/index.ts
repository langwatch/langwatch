/**
 * License: screen in `@langwatch/enterprise-licensing-web` — same
 * `enterprise-direction` finding as billing and scim
 * (`ui-family-move-manifests.md`).
 */

import { licensingApi } from "@langwatch/enterprise-licensing-web/screens/licensing";
import { uiFeature } from "../../behavior/ui-feature";
import { licensingFailures } from "./behavior/licensing-failures";
import { licensingPageLoaders } from "./ui/sections/licensing-routes";

export const licensingFeature = uiFeature({
  name: "@langwatch/enterprise-licensing-web",
  api: licensingApi,
  failures: licensingFailures,
  loaders: licensingPageLoaders,
});

export { licensingSeatTypeCopy, licensingUiSlots } from "./ui/sections/licensing-slots";

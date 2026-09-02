/**
 * The organization settings family, as this application composes it.
 *
 * The screen lives in `@langwatch/organization-web`; what belongs to the
 * application is which page key the address answers, the grant in front of it,
 * the settings chrome around it, the transport its hooks run on, and the host
 * port that turns this application's capabilities into the questions the screen
 * asks — including the one no family asked before it, handing the reader a file.
 */

import { organizationApi } from "@langwatch/organization-web/screens/organization";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { organizationPageLoaders } from "./ui/sections/organization-routes";

export const organizationApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/organization-web",
  api: organizationApi,
});

export { organizationPageLoaders };

/**
 * The navigation family: the landing screen lives in
 * `@langwatch/navigation-web`; this owns the page key, transport and host
 * port. The package's project switcher is chrome, composed by `features/chrome`.
 */

import { navigationApi } from "@langwatch/navigation-web/screens/landing";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { navigationPageLoaders } from "./ui/sections/navigation-routes";

export const navigationApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/navigation-web",
  api: navigationApi,
});

export { navigationPageLoaders };
export { NavigationHostSection } from "./ui/sections/navigation-host";

/**
 * The navigation family: the landing screen lives in
 * `@langwatch/navigation-web`; this owns the page key, transport and host
 * port. The package's project switcher is chrome, composed by `features/chrome`.
 */

import { navigationApi } from "@langwatch/navigation-web/screens/navigation";
import { uiFeature } from "../../behavior/ui-feature";
import { navigationPageLoaders } from "./ui/sections/navigation-routes";

export const navigationFeature = uiFeature({
  name: "@langwatch/navigation-web",
  api: navigationApi,
  loaders: navigationPageLoaders,
});

export { NavigationHostSection } from "./ui/sections/navigation-host";

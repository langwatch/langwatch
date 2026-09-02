/**
 * The navigation family, as this application composes it.
 *
 * The landing screen lives in `@langwatch/navigation-web`; what belongs to the
 * application is which page key the root address answers, the transport the
 * package's hooks run on, and the host port that turns this application's scope
 * resolution, session and address bar into the questions the redirect asks.
 *
 * The same package also publishes the project switcher, which is chrome rather
 * than a page — `features/chrome` composes that half.
 */

import { navigationApi } from "@langwatch/navigation-web/screens/landing";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { navigationPageLoaders } from "./ui/sections/navigation-routes";

export const navigationApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/navigation-web",
  api: navigationApi,
});

export { navigationPageLoaders };
export {
  NavigationHostSection,
  withNavigationHost,
} from "./ui/sections/navigation-host-provider";

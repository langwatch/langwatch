/**
 * Which page keys navigation answers: three decisions, not product
 * surfaces, none guarded. All three wrap the host — idempotent with the
 * chrome's own mount, so wrapping stays uniform.
 */

import { navigationScreens } from "@langwatch/navigation-web/screens/landing";
import type { UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import { uiPage } from "../../../../ui/sections/ui-page";
import { NavigationHostSection } from "./navigation-host";

export const navigationPageLoaders: UiPageLoaderRegistry = {
  "pages/index": uiPage({ screen: navigationScreens.landing, host: NavigationHostSection }),
  "pages/not-found": uiPage({ screen: navigationScreens.notFound, host: NavigationHostSection }),
  "pages/@project/[...path]/index": uiPage({
    screen: navigationScreens.projectRedirect,
    host: NavigationHostSection,
  }),
};

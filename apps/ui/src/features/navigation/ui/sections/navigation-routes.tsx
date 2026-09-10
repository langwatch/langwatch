/**
 * Which page keys navigation answers: three decisions, not product
 * surfaces, none guarded. All three wrap the host — idempotent with the
 * chrome's own mount, so wrapping stays uniform.
 */

import { navigationScreens } from "@langwatch/navigation-web/navigation";
import type { UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import { uiPage } from "../../../../ui/sections/ui-page";
import { NavigationHostSection } from "./navigation-host";

export const navigationPageLoaders: UiPageLoaderRegistry = {
  "pages/index": uiPage({ screen: navigationScreens.landing, host: NavigationHostSection }),
  "pages/not-found": uiPage({ screen: navigationScreens.notFound, host: NavigationHostSection }),
  /**
   * The same page, for an address under `/settings` that names nothing. A second key rather
   * than a second route on the same one, because the route table's `/settings/*` entry sits
   * inside the settings group so the sidebar and top bar stay drawn around it.
   */
  "pages/settings/not-found": uiPage({
    screen: navigationScreens.notFound,
    host: NavigationHostSection,
  }),
  "pages/@project/[...path]/index": uiPage({
    screen: navigationScreens.projectRedirect,
    host: NavigationHostSection,
  }),
};

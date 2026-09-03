/**
 * Which page keys navigation answers, and what each is wrapped in.
 *
 * THREE KEYS, THREE SCREENS, and all three are navigation DECISIONS rather than
 * product surfaces: `/` sends a reader somewhere, `/@project/<rest>` puts their
 * own project slug in front of an address written without one, and the
 * not-found page is what an address that names no page resolves to.
 *
 * The keys read as they always did, kept rather than renamed: the route
 * transcript in `apps/ui/tests` is the parity bar for the URL surface and fails
 * the moment a page key changes, so renaming one would spend that guard's
 * signal on a cosmetic edit.
 *
 * NO PAGE GUARD ON ANY OF THEM, deliberately, and none of the platform pages
 * had one. All three are the addresses a reader reaches when they do not yet
 * know where they belong, and a grant in front of one would refuse the pages
 * that exist to send people somewhere they are allowed to be.
 *
 * `pages/index` is wrapped in the host because it can be reached OUTSIDE the
 * chrome layout route. The other two sit inside it, and the chrome mounts one
 * host above the outlet — but the wrapper is idempotent in the way that
 * matters: a second provider publishes the same value built from the same
 * reads, so wrapping all three keeps the seam uniform rather than making the
 * page's mount point part of its contract.
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

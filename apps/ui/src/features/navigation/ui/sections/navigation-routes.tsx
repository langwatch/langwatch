/**
 * Which page key the root address answers, and what it is wrapped in.
 *
 * ONE KEY, ONE SCREEN. `pages/index` still reads as it always did, kept rather
 * than renamed: the route transcript in `apps/ui/tests` is the parity bar for
 * the URL surface and fails the moment a page key changes, so renaming one
 * would spend that guard's signal on a cosmetic edit.
 *
 * NO PAGE GUARD, deliberately, and the platform page had none either. `/` is
 * where a signed-in reader with nowhere in particular to go arrives, and the
 * screen's whole body is a redirect: a grant in front of it would refuse the
 * one address that exists to send people somewhere they are allowed to be.
 */

import { navigationScreens } from "@langwatch/navigation-web/screens/landing";
import type { UiPageLoader, UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import { withNavigationHost } from "./navigation-host-provider";

const landingPage: UiPageLoader = async () => {
  const module = await navigationScreens.landing();
  return { default: withNavigationHost(module.default) };
};

export const navigationPageLoaders: UiPageLoaderRegistry = {
  "pages/index": landingPage,
};

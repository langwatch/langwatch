/**
 * Which page key the License address answers, and what it is wrapped in.
 *
 * ONE KEY, ONE SCREEN. THERE IS NO GUARD, one for one with the platform page:
 * this was the only settings page wrapped in no `withPermissionGuard` at all,
 * and inventing one would be a change to who can reach an address that a page
 * move does not own. Every procedure behind it states its own policy.
 */

import { licensingScreens } from "@langwatch/enterprise-licensing-web/screens/license";
import type { ComponentType } from "react";

import type { UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import { uiPage } from "../../../../ui/sections/ui-page";
import { LicensingHost } from "./licensing-host";

export const licensingPageLoaders: UiPageLoaderRegistry = {
  "pages/settings/license": uiPage({
    screen: async () => ({ default: (await licensingScreens.license()).default as ComponentType }),
    host: LicensingHost,
    settingsLayout: true,
  }),
};

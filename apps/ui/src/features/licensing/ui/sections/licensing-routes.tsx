/** Which page key the License address answers: no guard, matching the platform page — every procedure behind it states its own policy. */

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

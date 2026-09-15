/** License pages with no guard; each procedure handles its own authorization policy. */

import { licensingScreens } from "@langwatch/enterprise-licensing-web/licensing";
import type { ComponentType } from "react";

import type { UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import { uiPage } from "../../../../ui/sections/ui-page";
import { LicensingHost } from "./licensing-host";

export const licensingPageLoaders: UiPageLoaderRegistry = {
  "pages/settings/license": uiPage({
    screen: async () => ({ default: (await licensingScreens.license()).default as ComponentType }),
    host: LicensingHost,
  }),
};

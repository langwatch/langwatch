/** Secrets management; permissions checked inside the page. */

import { secretScreens } from "@langwatch/secret-web/secrets";
import type { ComponentType } from "react";
import type { UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import { uiPage } from "../../../../ui/sections/ui-page";
import { SecretHost } from "./secret-host";

export const secretPageLoaders: UiPageLoaderRegistry = {
  "pages/settings/secrets": uiPage({
    screen: async () => ({ default: (await secretScreens.secrets()).default as ComponentType }),
    host: SecretHost,
  }),
};

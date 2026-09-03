/**
 * Which page key the Secrets address answers: no page-level grant —
 * `secrets:manage` is read inside the page, so a `secrets:view`-only reader sees the names with no way to change them.
 */

import { secretScreens } from "@langwatch/secret-web/screens/secret";
import type { ComponentType } from "react";
import type { UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import { uiPage } from "../../../../ui/sections/ui-page";
import { SecretHost } from "./secret-host";

export const secretPageLoaders: UiPageLoaderRegistry = {
  "pages/settings/secrets": uiPage({
    screen: async () => ({ default: (await secretScreens.secrets()).default as ComponentType }),
    host: SecretHost,
    settingsLayout: true,
  }),
};

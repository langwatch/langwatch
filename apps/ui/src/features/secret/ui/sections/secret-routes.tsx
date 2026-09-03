/**
 * Which page key the Secrets address answers, and what it is wrapped in.
 *
 * ONE KEY, ONE SCREEN. The key still reads `pages/settings/secrets`, kept rather
 * than renamed: the route transcript in `apps/ui/tests` is the parity bar for the
 * URL surface and fails the moment a page key changes, so renaming one would
 * spend that guard's signal on a cosmetic edit.
 *
 * NO PAGE-LEVEL GRANT: the platform page was `SettingsLayout` and nothing else,
 * and read `secrets:manage` inside the page to decide whether the write
 * controls are live. A reader with only `secrets:view` sees the names and no
 * way to change them.
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

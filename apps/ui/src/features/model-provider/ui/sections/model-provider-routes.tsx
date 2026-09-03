/**
 * Which page keys the Model Provider settings addresses answer, and what they
 * are wrapped in.
 *
 * TWO KEYS, TWO SCREENS. The keys still read `pages/settings/model-providers`
 * and `pages/settings/model-costs`, and they are kept rather than renamed: the
 * route transcript in `apps/ui/tests` is the parity bar for the URL surface and
 * fails the moment a page key changes, so renaming one would spend that guard's
 * signal on a cosmetic edit.
 *
 * NEITHER KEY CARRIES A PAGE-LEVEL GRANT, and that is the platform pages'
 * policy one for one: both were `SettingsLayout` and nothing else, and both read
 * `hasPermission("project:manage")` INSIDE the page to decide whether the write
 * controls are live. A reader who cannot manage providers can still see which
 * ones exist, which is what a project-scoped member needs in order to know why a
 * model is missing. Inventing a guard here would refuse them the page.
 */

import { modelProviderScreens } from "@langwatch/model-provider-web/screens/model-provider";
import type { ComponentType } from "react";
import type { UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import { uiPage } from "../../../../ui/sections/ui-page";
import { ModelProviderHost } from "./model-provider-host";

export const modelProviderPageLoaders: UiPageLoaderRegistry = {
  "pages/settings/model-providers": uiPage({
    screen: async () => ({
      default: (await modelProviderScreens.modelProviders()).default as ComponentType,
    }),
    host: ModelProviderHost,
    settingsLayout: true,
  }),
  "pages/settings/model-costs": uiPage({
    screen: async () => ({
      default: (await modelProviderScreens.modelCosts()).default as ComponentType,
    }),
    host: ModelProviderHost,
    settingsLayout: true,
  }),
};

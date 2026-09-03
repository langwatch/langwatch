/**
 * Which page keys the Model Provider settings addresses answer. Neither
 * carries a page-level grant: both read `project:manage` inside the page,
 * so a reader who can't manage providers still sees which ones exist.
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

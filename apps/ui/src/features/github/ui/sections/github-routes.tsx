/**
 * Which page key the Integrations address answers, and what it is wrapped in.
 *
 * ONE KEY, ONE SCREEN. The grant is the platform page's own `organization:manage`.
 */

import { githubScreens } from "@langwatch/github-web/screens/integrations";
import type { ComponentType } from "react";

import type { UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import { uiPage } from "../../../../ui/sections/ui-page";
import { GithubHost } from "./github-host";

/** The grant the platform page asked for, unchanged. */
const INTEGRATIONS_PAGE_PERMISSION = "organization:manage";

export const githubPageLoaders: UiPageLoaderRegistry = {
  "pages/settings/integrations": uiPage({
    screen: async () => ({ default: (await githubScreens.integrations()).default as ComponentType }),
    host: GithubHost,
    settingsLayout: true,
    permission: INTEGRATIONS_PAGE_PERMISSION,
  }),
};

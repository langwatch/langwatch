/**
 * Which page key the general Settings address answers: the member's grant,
 * not the administrator's — every member may read the settings, and each
 * control is separately disabled for a reader who may not change it.
 */

import { projectScreens } from "@langwatch/project-web/screens/project";
import type { ComponentType } from "react";

import type { UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import { uiPage } from "../../../../ui/sections/ui-page";
import { ProjectHost } from "./project-host";

const PROJECT_SETTINGS_PAGE_PERMISSION = "organization:view";

export const projectPageLoaders: UiPageLoaderRegistry = {
  "pages/settings": uiPage({
    screen: async () => ({
      default: (await projectScreens.projectSettings()).default as ComponentType,
    }),
    host: ProjectHost,
    settingsLayout: true,
    permission: PROJECT_SETTINGS_PAGE_PERMISSION,
  }),
};

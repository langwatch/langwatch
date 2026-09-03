/**
 * Which page key the general Settings address answers, and what it is wrapped in.
 *
 * ONE KEY, ONE SCREEN.
 *
 * THE GRANT IS THE MEMBER'S, not the administrator's, and that is deliberate:
 * every member may READ their organization's settings, and each control on the
 * page is separately disabled for a reader who may not change it. Hiding the
 * page would tell a member nothing about what their organization is configured
 * to do.
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

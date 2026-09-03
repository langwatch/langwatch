/**
 * Which page key the Topic Clustering address answers, and what it is wrapped in.
 *
 * ONE KEY, ONE SCREEN, the same `project:manage` grant the platform page's own
 * `withPermissionGuard({ layoutComponent: SettingsLayout })` framed.
 */

import { topicScreens } from "@langwatch/topic-web/screens/topic-clustering";
import type { ComponentType } from "react";

import type { UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import { uiPage } from "../../../../ui/sections/ui-page";
import { TopicHost } from "./topic-host";

export const topicPageLoaders: UiPageLoaderRegistry = {
  "pages/settings/topic-clustering": uiPage({
    screen: async () => ({
      default: (await topicScreens.topicClustering()).default as ComponentType,
    }),
    host: TopicHost,
    settingsLayout: true,
    permission: "project:manage",
  }),
};

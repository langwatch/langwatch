/** Which page key the Topic Clustering address answers: `project:manage`, the same grant the platform page framed. */

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

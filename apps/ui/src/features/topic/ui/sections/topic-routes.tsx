/** Topic Clustering page key: `project:manage`. */

import { topicScreens } from "@langwatch/topic-web/topic-clustering";
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
    permission: "project:manage",
  }),
};

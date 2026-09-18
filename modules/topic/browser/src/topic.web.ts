/**
 * What a browser installs when it installs topic: the topic-clustering
 * schedule screen.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

export const topicWeb = defineWebModule("topic")
  .withHosts({
    requires: ["TopicHostApi"],
    mounts: { TopicHostApi: { load: () => import("./behavior/topic-host-mount.tsx") } },
  })
  .withScreens({
    // Placed by the application's settings table until a settings anchor
    // accepts declared routes; the loader is this module's either way.
    "pages/settings/topic-clustering": {
      path: "/settings/topic-clustering",
      within: "settings",
      label: "Topic Clustering",
      load: () => import("./ui/sections/topic-clustering.screen.tsx"),
    },
  });

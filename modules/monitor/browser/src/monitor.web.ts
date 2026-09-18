/**
 * What a browser installs when it installs monitor: the online-evaluations
 * screen a project runs over its live traces and threads.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

export const monitorWeb = defineWebModule("monitor")
  .withHosts({
    requires: ["MonitorHostApi"],
    mounts: { MonitorHostApi: { load: () => import("./behavior/monitor-host-mount.tsx") } },
  })
  .withScreens({
    "pages/[project]/online-evaluations": {
      path: "/:project/online-evaluations",
      within: "project",
      label: "Online Evaluations",
      load: () => import("./ui/sections/online-evaluations.screen.tsx"),
    },
  });

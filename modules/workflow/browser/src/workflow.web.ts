/**
 * What a browser installs when it installs workflow: the workflow list, the
 * Optimization Studio, and the workflow chat.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

export const workflowWeb = defineWebModule("workflow").withScreens({
  "pages/[project]/workflows": {
    load: () => import("./ui/sections/workflows/workflows-screen.tsx"),
  },
  "pages/[project]/studio/[workflow]": {
    load: () => import("./ui/sections/workflows/studio-screen.tsx"),
  },
  "pages/[project]/chat/[workflow]": {
    load: () => import("./ui/sections/workflows/workflow-chat-screen.tsx"),
  },
});

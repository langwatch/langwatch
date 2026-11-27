/**
 * What a browser installs when it installs staff access: the operator's agents page and the
 * approval page an agent's request links to. Both answer not found while the feature is off.
 */

import { defineBrowserModule } from "@langwatch/browser";

export const staffAccessWeb = defineBrowserModule("staff-access").withScreens({
  "pages/ops/agents": {
    requires: "ops:manage",
    load: () => import("./ui/sections/agents.screen.tsx"),
  },
  "pages/ops/agents/approve/[requestId]": {
    requires: "ops:manage",
    load: () => import("./ui/sections/approve-request.screen.tsx"),
  },
});

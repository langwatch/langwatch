/**
 * What a browser installs when it installs automation: the automations
 * family's four tabs. `/automations/activity` and `/unsubscribe` are not
 * declared — no matching section, and no anchor — see the handoff.
 */

import { defineWebModule } from "@langwatch/ui-kernel";
import { createElement } from "react";

import type { AutomationSection } from "./ui/sections/automations-layout.tsx";

/** The same page renders all four tabs; the section is the route's own key. */
function automationTab(section: AutomationSection) {
  return async () => {
    const { AutomationsPage } = await import("./ui/sections/automations-screen.tsx");

    return {
      default: () => createElement<{ section?: AutomationSection }>(AutomationsPage, { section }),
    };
  };
}

export const automationWeb = defineWebModule("automation").withScreens({
  "pages/[project]/automations": {
    path: "/:project/automations",
    within: "project",
    label: "Automations",
    load: automationTab("overview"),
  },
  "pages/[project]/automations/automations": {
    path: "/:project/automations/automations",
    within: "project",
    load: automationTab("automations"),
  },
  "pages/[project]/automations/alerts": {
    path: "/:project/automations/alerts",
    within: "project",
    load: automationTab("alerts"),
  },
  "pages/[project]/automations/schedules": {
    path: "/:project/automations/schedules",
    within: "project",
    load: automationTab("schedules"),
  },
});

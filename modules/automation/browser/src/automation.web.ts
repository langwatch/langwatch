/**
 * What a browser installs when it installs automation: the automations
 * family's four tabs, plus the one-click unsubscribe an email link opens.
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

export const automationWeb = defineWebModule("automation")
  .withHosts({
    requires: ["AutomationHost"],
    mounts: { AutomationHost: { load: () => import("./behavior/automation-host-mount.tsx") } },
  })
  .withDrawers({
    automation: {
      load: async () => ({
        default: (await import("./features/authoring/ui/sections/automation-drawer.tsx"))
          .RegisteredAutomationDrawer,
      }),
    },
    viewAutomation: {
      load: async () => ({
        default: (await import("./features/authoring/ui/sections/view-automation-drawer.tsx"))
          .RegisteredViewAutomationDrawer,
      }),
    },
  })
  .withScreens({
    "pages/[project]/automations": {
      path: "/:project/automations",
      within: "project",
      label: "Automations",
      requires: "triggers:view",
      load: automationTab("overview"),
    },
    "pages/[project]/automations/automations": {
      path: "/:project/automations/automations",
      within: "project",
      requires: "triggers:view",
      load: automationTab("automations"),
    },
    "pages/[project]/automations/alerts": {
      path: "/:project/automations/alerts",
      within: "project",
      requires: "triggers:view",
      load: automationTab("alerts"),
    },
    "pages/[project]/automations/schedules": {
      path: "/:project/automations/schedules",
      within: "project",
      requires: "triggers:view",
      load: automationTab("schedules"),
    },
    /** Main's activity address re-rendered the overview, whose recent activity it links to. */
    "pages/[project]/automations/activity": {
      path: "/:project/automations/activity",
      within: "project",
      requires: "triggers:view",
      load: automationTab("overview"),
    },
    /** Reached from an email link, outside the project chrome. */
    "pages/unsubscribe": {
      load: () => import("./ui/sections/unsubscribe-screen.tsx"),
    },
  });

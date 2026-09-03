/**
 * Which page key each automations tab answers. Five keys, one screen — each
 * key tells the screen its tab. `/activity` shows `overview`: kept for old
 * links since the History tab folded into it.
 */

import {
  automationScreens,
  type AutomationSection,
} from "@langwatch/automation-web/screens/automations";
import type { ComponentType } from "react";
import type { UiPageLoader, UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import { uiPage } from "../../../../ui/sections/ui-page";
import { AutomationsHost } from "./automations-host";

/** The grant the platform page asked for, unchanged. */
const AUTOMATIONS_PERMISSION = "triggers:view";

function automationsPage(section: AutomationSection): UiPageLoader {
  return uiPage({
    screen: async () => {
      const module = await automationScreens.automations();
      const Screen = module.default as ComponentType<{ section?: AutomationSection }>;
      const OnSection = () => <Screen section={section} />;
      OnSection.displayName = `AutomationsPage(${section})`;
      return { default: OnSection };
    },
    host: AutomationsHost,
    permission: AUTOMATIONS_PERMISSION,
  });
}

export const automationsPageLoaders: UiPageLoaderRegistry = {
  "pages/[project]/automations": automationsPage("overview"),
  "pages/[project]/automations/automations": automationsPage("automations"),
  "pages/[project]/automations/alerts": automationsPage("alerts"),
  "pages/[project]/automations/schedules": automationsPage("schedules"),
  "pages/[project]/automations/activity": automationsPage("overview"),
};

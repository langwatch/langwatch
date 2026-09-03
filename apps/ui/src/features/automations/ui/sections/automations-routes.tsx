/**
 * Which page key each automations tab answers, and what it is wrapped in.
 *
 * The route table names FIVE page keys under `/:project/automations` and the
 * package exposes ONE screen, because the five addresses were always one page:
 * `platform/app`'s loader registry pointed all five keys at the same module,
 * and the module then matched the pathname to decide which tab to show. This is
 * the map between the two vocabularies, and it makes the tab explicit — a key
 * names a tab here, so the screen is told rather than having to read the
 * address back.
 *
 * `/:project/automations/activity` is the fifth key and it shows the OVERVIEW,
 * which is what it has shown since the History tab was folded into the overview
 * page. The address is kept because links to it exist; nothing about the page
 * distinguishes it any more.
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

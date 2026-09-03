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
 *
 * Each page is wrapped twice, and the order matters. The host provider is
 * OUTSIDE the guard: a refusal renders the guard's own fallback, which asks
 * nothing of the automation host, but a page that opens needs the host mounted
 * above it before its first render. Inside that, the guard states the policy
 * the platform higher-order component carried.
 *
 * THE POLICY IS THE PLATFORM PAGE'S, ONE FOR ONE: `withPermissionGuard`
 * ("triggers:view") and no flag. `layoutComponent: DashboardLayout` was the
 * other half of that call and does not travel — chrome belongs to the route
 * tree, and these pages are children of a layout route the composing
 * application still serves.
 *
 * The wrapping happens once per lazy load rather than once per render: React
 * Router caches what a `lazy` resolves to, so the component identity below is
 * stable for the life of the route.
 */

import {
  automationScreens,
  type AutomationSection,
} from "@langwatch/automation-web/screens/automations";
import type { ComponentType } from "react";
import type { UiPageLoader, UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import {
  UiPageForbidden,
  UiPageLoading,
  UiPageNotFound,
} from "../../../../ui/elements/ui-page-fallbacks";
import { withUiPageGuard } from "../../../../ui/sections/ui-page-guard";
import { withAutomationsHost } from "./automations-host-provider";

/** The grant the platform page asked for, unchanged. */
const AUTOMATIONS_PERMISSION = "triggers:view";

const FALLBACKS = {
  loading: UiPageLoading,
  notFound: UiPageNotFound,
  forbidden: UiPageForbidden,
};

function automationsPage(section: AutomationSection): UiPageLoader {
  return async () => {
    const module = await automationScreens.automations();
    const Screen = module.default as ComponentType<{ section?: AutomationSection }>;
    const OnSection = () => <Screen section={section} />;
    OnSection.displayName = `AutomationsPage(${section})`;
    const guarded = withUiPageGuard({
      permission: AUTOMATIONS_PERMISSION,
      fallbacks: FALLBACKS,
    })(OnSection);
    return { default: withAutomationsHost(guarded) };
  };
}

export const automationsPageLoaders: UiPageLoaderRegistry = {
  "pages/[project]/automations": automationsPage("overview"),
  "pages/[project]/automations/automations": automationsPage("automations"),
  "pages/[project]/automations/alerts": automationsPage("alerts"),
  "pages/[project]/automations/schedules": automationsPage("schedules"),
  "pages/[project]/automations/activity": automationsPage("overview"),
};

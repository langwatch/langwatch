/**
 * Automations: screen, two editors and the guardless public `/unsubscribe`
 * page, one transport, in `@langwatch/automation-web`. Serves
 * `automation`/`viewAutomation`, written by every "Edit automation" link.
 */

import { automationApi } from "@langwatch/automation-web/screens/automations";
import { lazyDrawer, type UiDrawerRegistry } from "@langwatch/ui-drawer";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { automationsPageLoaders } from "./ui/sections/automations-routes";
import { unsubscribePageLoaders } from "./ui/sections/unsubscribe-routes";

export const automationsApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/automation-web",
  api: automationApi,
});

/** The drawers this family serves, by the name the address uses. */
export const automationsDrawers: UiDrawerRegistry = {
  automation: lazyDrawer({
    factory: () => import("./ui/sections/automations-drawers"),
    key: "AutomationDrawer",
  }),
  viewAutomation: lazyDrawer({
    factory: () => import("./ui/sections/automations-drawers"),
    key: "ViewAutomationDrawer",
  }),
};

export const automationsAllPageLoaders = {
  ...automationsPageLoaders,
  ...unsubscribePageLoaders,
};

export { automationsPageLoaders, unsubscribePageLoaders };

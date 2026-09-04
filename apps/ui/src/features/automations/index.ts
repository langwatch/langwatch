/**
 * Automations: screen, two editors and the guardless public `/unsubscribe`
 * page, one transport, in `@langwatch/automation-web`. Serves
 * `automation`/`viewAutomation`, written by every "Edit automation" link.
 */

import { automationApi } from "@langwatch/automation-web/screens/automations";
import { lazyDrawer } from "@langwatch/ui-drawer";
import { uiFeature } from "../../behavior/ui-feature";
import { automationsPageLoaders as automationsOwnPageLoaders } from "./ui/sections/automations-routes";
import { unsubscribePageLoaders } from "./ui/sections/unsubscribe-routes";

const automationsPageLoaders = {
  ...automationsOwnPageLoaders,
  ...unsubscribePageLoaders,
};

export const automationsFeature = uiFeature({
  name: "@langwatch/automation-web",
  api: automationApi,
  loaders: automationsPageLoaders,
  /** The drawers this family serves, by the name the address uses. */
  drawers: {
    automation: lazyDrawer({
      factory: () => import("./ui/sections/automations-drawers"),
      key: "AutomationDrawer",
    }),
    viewAutomation: lazyDrawer({
      factory: () => import("./ui/sections/automations-drawers"),
      key: "ViewAutomationDrawer",
    }),
  },
});

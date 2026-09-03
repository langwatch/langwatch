/**
 * The automations family, as this application composes it.
 *
 * The screen and its two editors live in `@langwatch/automation-web`; what
 * belongs to the application is everything they are not allowed to own — which
 * page key each of the four tabs answers, the permission policy in front of
 * them, the transport their hooks run on, and the host port that turns this
 * application's capabilities into the questions the family asks.
 *
 * `/unsubscribe` RIDES ON THE SAME TRANSPORT AND NOTHING ELSE. It is a public
 * page a recipient opens from a mail client, so it is registered here with no
 * guard and no host — see `ui/sections/unsubscribe-routes.tsx` for why both are
 * absent — and it is one binding, not two, because `emailSuppression.*` is
 * mounted out of the same package as `automation.*` and both screens' hooks run
 * on one Provider.
 *
 * IT SERVES ONE DRAWER AS WELL AS ITS PAGES, and that one leaves the product:
 * every alert email carries `?drawer.open=automation&drawer.automationId=<id>`
 * as its "Edit automation" link, and so do the trace explorer's Automate
 * button, the command palette and Langy's relay links. The name was never
 * registered, so all of them landed on the automations list with nothing open.
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
};

export const automationsAllPageLoaders = {
  ...automationsPageLoaders,
  ...unsubscribePageLoaders,
};

export { automationsPageLoaders, unsubscribePageLoaders };

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
 */

import { automationApi } from "@langwatch/automation-web/screens/automations";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { automationsPageLoaders } from "./ui/sections/automations-routes";
import { unsubscribePageLoaders } from "./ui/sections/unsubscribe-routes";

export const automationsApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/automation-web",
  api: automationApi,
});

export const automationsAllPageLoaders = {
  ...automationsPageLoaders,
  ...unsubscribePageLoaders,
};

export { automationsPageLoaders, unsubscribePageLoaders };

/**
 * Which page keys the billing addresses answer. Grants disagree on purpose,
 * matching the platform pages: Plans wants `organization:view`, Usage wants
 * `cost:view`, Subscription wants neither — every procedure behind it states its own policy.
 */

import { billingScreens } from "@langwatch/enterprise-billing-web/screens/billing";
import type { ComponentType } from "react";

import type { UiPageLoader, UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import { uiPage } from "../../../../ui/sections/ui-page";
import { BillingHost } from "./billing-host";

/** The grant the plans page asked for, unchanged. */
const PLANS_PAGE_PERMISSION = "organization:view";
/** The grant the usage page asked for, unchanged. */
const USAGE_PAGE_PERMISSION = "cost:view";

function billingPage(
  screen: () => Promise<{ default: ComponentType }>,
  displayName: string,
  permission?: string,
): UiPageLoader {
  return uiPage({
    screen: async () => {
      const module = await screen();
      const Component = module.default as ComponentType & { displayName?: string };
      Component.displayName = displayName;
      return { default: Component };
    },
    host: BillingHost,
    settingsLayout: true,
    permission,
  });
}

export const billingPageLoaders: UiPageLoaderRegistry = {
  "pages/settings/plans": billingPage(billingScreens.plans, "PlansPage", PLANS_PAGE_PERMISSION),
  "pages/settings/subscription": billingPage(billingScreens.subscription, "SubscriptionPage"),
  "pages/settings/usage": billingPage(billingScreens.usage, "UsagePage", USAGE_PAGE_PERMISSION),
};

/**
 * Which page keys the billing addresses answer, and what they are wrapped in.
 *
 * THREE KEYS, THREE SCREENS, and the same three wrappers in the same order as
 * every other settings family: the host outermost, the harvested settings
 * chrome inside it, and the platform page's own grant innermost.
 *
 * THE GRANTS ARE THE PLATFORM PAGES', ONE FOR ONE, AND THEY DISAGREE WITH EACH
 * OTHER. Plans carried `organization:view`, Usage carried `cost:view`, and
 * Subscription carried nothing at all. The asymmetry is carried rather than
 * tidied: inventing a guard is a change to who can reach an address, and a page
 * move does not own that decision. It is not a hole — every procedure behind
 * the unguarded key states its own policy — but it is RECORDED, so whoever owns
 * billing permissions can decide whether Subscription should state one.
 */

import { billingScreens } from "@langwatch/enterprise-billing-web/screens/billing";
import type { ComponentType } from "react";

import type { UiPageLoader, UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import {
  UiPageForbidden,
  UiPageLoading,
  UiPageNotFound,
} from "../../../../ui/elements/ui-page-fallbacks";
import { withUiPageGuard } from "../../../../ui/sections/ui-page-guard";
import { withUiSettingsLayout } from "../../../../ui/sections/ui-settings-layout";
import {
  PLANS_PAGE_PERMISSION,
  USAGE_PAGE_PERMISSION,
} from "../../behavior/billing-host.adapter";
import { withBillingHost } from "./billing-host-provider";

const FALLBACKS = {
  loading: UiPageLoading,
  notFound: UiPageNotFound,
  forbidden: UiPageForbidden,
};

function billingPage(
  screen: () => Promise<{ default: ComponentType }>,
  displayName: string,
  permission?: string,
): UiPageLoader {
  return async () => {
    const module = await screen();
    const guarded = withUiPageGuard({
      ...(permission ? { permission } : {}),
      fallbacks: FALLBACKS,
    })(module.default as ComponentType);
    guarded.displayName = displayName;
    return { default: withBillingHost(withUiSettingsLayout(guarded)) };
  };
}

export const billingPageLoaders: UiPageLoaderRegistry = {
  "pages/settings/plans": billingPage(billingScreens.plans, "PlansPage", PLANS_PAGE_PERMISSION),
  "pages/settings/subscription": billingPage(billingScreens.subscription, "SubscriptionPage"),
  "pages/settings/usage": billingPage(billingScreens.usage, "UsagePage", USAGE_PAGE_PERMISSION),
};

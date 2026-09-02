/**
 * The billing family, as the browser application mounts it.
 *
 * THREE SCREENS, THREE ADDRESSES: `/settings/plans`, `/settings/subscription`
 * and `/settings/usage`.
 *
 * WHY ALL THREE ARE HERE. The credentials family's rule: a key belongs to the
 * family that owns its TRANSPORT. `plan.getActivePlan`, `limits.getUsage`,
 * `subscription.*` and `currency.detectCurrency` are billing's, and the pricing
 * catalogue every one of these pages renders was already in this package before
 * they arrived. Usage also reads `license.getStatus`, which is the licensing
 * family's — it is one boolean branch on a page whose other two branches are
 * entirely billing's, so the key follows the majority of its reads rather than
 * splitting a page in half.
 *
 * WHAT THE OWNING FRONTEND FEATURE HAS TO MOUNT is the tRPC Provider this
 * package's hooks run on and the host port that answers for the organization,
 * the active team, the deployment, the address, the departure to Stripe and the
 * two notices.
 */

import type { ComponentType } from "react";

export type BillingScreenLoader = () => Promise<{ default: ComponentType }>;

export const billingScreens = {
  plans: () => import("./plans.screen"),
  subscription: () => import("./subscription.screen"),
  usage: () => import("./usage.screen"),
} as const satisfies Record<string, BillingScreenLoader>;

export type BillingScreenName = keyof typeof billingScreens;

export { PLANS_PAGE_PERMISSION } from "./plans.screen";
export { SUBSCRIPTION_PAGE_PERMISSION } from "./subscription.screen";
export { USAGE_PAGE_PERMISSION } from "./usage.screen";
export { billingApi, type BillingApiMap } from "../../behavior/billing-api";
export {
  BillingHostPort,
  BillingHostProvider,
  type BillingFailureNotice,
  type BillingHostOrganization,
  type BillingSuccessNotice,
} from "../../model/billing-host";

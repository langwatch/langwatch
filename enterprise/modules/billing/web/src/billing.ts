/**
 * Billing family mounted in browser app: plans, subscription, usage screens.
 * Mounter provides tRPC Provider and host port for org/team/deployment.
 */

import type { ComponentType } from "react";

export type BillingScreenLoader = () => Promise<{ default: ComponentType }>;

export const billingScreens = {
  plans: () => import("./ui/sections/plans.screen.tsx"),
  subscription: () => import("./ui/sections/subscription.screen.tsx"),
  usage: () => import("./ui/sections/usage.screen.tsx"),
} as const satisfies Record<string, BillingScreenLoader>;

export type BillingScreenName = keyof typeof billingScreens;

export { PLANS_PAGE_PERMISSION } from "./ui/sections/plans.screen.tsx";
export { SUBSCRIPTION_PAGE_PERMISSION } from "./ui/sections/subscription.screen.tsx";
export { USAGE_PAGE_PERMISSION } from "./ui/sections/usage.screen.tsx";
export { billingApi, type BillingApiMap } from "./behavior/billing-api.ts";
export {
  BillingHostPort,
  BillingHostProvider,
  type BillingFailureNotice,
  type BillingHostOrganization,
  type BillingSuccessNotice,
} from "./model/billing-host.ts";

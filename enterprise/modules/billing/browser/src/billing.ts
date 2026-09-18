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

export { billingApi, type BillingApiMap } from "./behavior/billing-api.ts";
export {
  BillingHostApi,
  BillingHostProvider,
  PLANS_PAGE_PERMISSION,
  SUBSCRIPTION_PAGE_PERMISSION,
  USAGE_PAGE_PERMISSION,
  type BillingFailureNotice,
  type BillingHostOrganization,
  type BillingSuccessNotice,
} from "./model/billing-host.ts";

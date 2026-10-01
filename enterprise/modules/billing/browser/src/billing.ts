/**
 * Billing family mounted in browser app: plans, subscription, usage screens.
 * Mounter provides tRPC Provider and host port for org/team/deployment.
 */

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

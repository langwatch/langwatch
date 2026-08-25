import { BillableEventsQueryService } from "@langwatch/enterprise-billing-server";

export * from "@langwatch/enterprise-billing-server";

/** App-local compatibility names while billing callers move onto the class API. */
export const getBillingMonth = BillableEventsQueryService.getBillingMonth;
export const getPreviousBillingMonth = BillableEventsQueryService.getPreviousBillingMonth;
export const billingMonthDateRange = BillableEventsQueryService.billingMonthDateRange;

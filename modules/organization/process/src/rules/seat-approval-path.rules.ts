import { CONTACT_SALES_URL } from "@langwatch/enterprise-licensing-contract";
import type { SeatApprovalPath } from "@langwatch/organization-contract";

/** The plan fields the approval path is decided from. */
export type SeatApprovalPlan = Readonly<{
  planSource: "license" | "subscription" | "free";
  type: string;
  free: boolean;
  overrideAddingLimitations?: boolean;
  maxMembers: number;
  userPrice?: Readonly<{ USD: number; EUR: number }>;
}>;

/** The subscription settings page every self-serve plan is upgraded from. */
export const SUBSCRIPTION_SETTINGS_PATH = "/settings/subscription";

/** The licence settings page, where a self-hosted licence buys or renews its seats. */
export const LICENSE_SETTINGS_PATH = "/settings/license";

/**
 * How an administrator approves one more seat, from how the organization pays (ruling R6):
 * a live Stripe seat subscription expands in place, a self-serve plan upgrades, a self-hosted
 * Growth licence buys seats, and anything account-managed contacts LangWatch.
 */
export function seatApprovalPath({
  isSaas,
  plan,
  pricingModel,
  currency,
  organizationName,
}: {
  isSaas: boolean;
  plan: SeatApprovalPlan;
  pricingModel: "TIERED" | "SEAT_EVENT" | null;
  currency: "USD" | "EUR";
  organizationName: string;
}): SeatApprovalPath {
  const newSeats = plan.maxMembers + 1;
  const contactSales: SeatApprovalPath = {
    kind: "contact_sales",
    url: contactSalesUrl({ organizationName, seats: newSeats }),
  };
  if (!isSaas) {
    return plan.planSource === "license" && plan.type === "GROWTH"
      ? { kind: "upgrade_licence", url: LICENSE_SETTINGS_PATH }
      : contactSales;
  }
  const accountManaged =
    plan.planSource === "license" ||
    plan.type === "ENTERPRISE" ||
    plan.overrideAddingLimitations === true;
  if (accountManaged) {
    return contactSales;
  }
  if (plan.planSource === "subscription" && !plan.free && pricingModel === "SEAT_EVENT") {
    return {
      kind: "stripe_seats",
      currentSeats: plan.maxMembers,
      newSeats,
      planType: plan.type,
      seatPrice: plan.userPrice ? { amount: plan.userPrice[currency], currency } : null,
    };
  }
  return { kind: "upgrade_plan", url: SUBSCRIPTION_SETTINGS_PATH };
}

/** The contact page, prefilled with the organization and the seats it needs. */
export function contactSalesUrl({
  organizationName,
  seats,
}: {
  organizationName: string;
  seats: number;
}): string {
  const url = new URL(CONTACT_SALES_URL);
  url.searchParams.set("organization", organizationName);
  url.searchParams.set("seats", String(seats));
  return url.toString();
}

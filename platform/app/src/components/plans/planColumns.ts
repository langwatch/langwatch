import { CONTACT_SALES_URL } from "../../../ee/licensing/constants";
import {
  type BillingInterval,
  type Currency,
  currencySymbol,
  ENTERPRISE_PLAN_FEATURES,
  FREE_PLAN_FEATURES,
  formatPrice,
  getGrowthPlanFeatures,
  getGrowthSeatPriceCents,
} from "../subscription/billing-plans";
import type { ComparisonPlanId } from "./planCurrentResolver";

/**
 * What the three columns are made of.
 *
 * Every value here is read from the billing catalogue — the seat price comes
 * out of Stripe through `getGrowthSeatPriceCents`, the bullets out of
 * `billing-plans`. Nothing on this page is a second copy of a number that
 * lives somewhere else.
 */
export type PlanColumn = {
  id: ComparisonPlanId;
  name: string;
  subtitle: string;
  features: string[];
};

export const getPlanColumns = (currency: Currency): PlanColumn[] => [
  {
    id: "free",
    name: "Free",
    subtitle: "For teams getting started",
    features: FREE_PLAN_FEATURES,
  },
  {
    id: "growth",
    name: "Growth",
    subtitle: "Seat and usage pricing for growing teams",
    features: getGrowthPlanFeatures(currency),
  },
  {
    id: "enterprise",
    name: "Enterprise",
    subtitle: "Regulated and high-volume deployments",
    features: ENTERPRISE_PLAN_FEATURES,
  },
];

/**
 * A price is a FIGURE and a UNIT, not one sentence.
 *
 * Split because they are read differently: the figure is what the eye lands on
 * when it crosses the row, the unit is the fine print that qualifies it. It is
 * also what lets the figure roll digit by digit when the currency changes —
 * a single string has nothing to roll.
 *
 * A tier that is not priced by the catalogue has no unit rather than an empty
 * one, so the card knows to set the whole thing as one line.
 */
export type PlanPrice = { amount: string; unit: string | null };

export function getPlanPrice({
  planId,
  currency,
  billingPeriod,
}: {
  planId: ComparisonPlanId;
  currency: Currency;
  billingPeriod: BillingInterval;
}): PlanPrice {
  if (planId === "free") {
    return { amount: `${currencySymbol[currency]}0`, unit: "per user/month" };
  }

  if (planId === "growth") {
    const seatPrice = getGrowthSeatPriceCents();
    const cents =
      billingPeriod === "annual"
        ? Math.round(seatPrice[currency].annual / 12)
        : seatPrice[currency].monthly;
    return {
      amount: formatPrice({ cents, currency }),
      unit: "per seat/month",
    };
  }

  return { amount: "Custom pricing", unit: null };
}

export type PlanAction = {
  label: string;
  href: string;
  isExternal?: boolean;
};

/**
 * The one thing this card asks of the reader, given where they already are.
 *
 * Free asks nothing: there is no tier under it to move to, and telling
 * somebody already on it to "get started" is a button that does nothing for
 * them. An organization already on Growth is asked to fill the seats it pays
 * for rather than to buy them again, and one already on Enterprise is asked
 * for nothing at all — there is nothing left to sell.
 */
export function getPlanAction({
  planId,
  currentPlan,
}: {
  planId: ComparisonPlanId;
  currentPlan: ComparisonPlanId | null;
}): PlanAction | null {
  if (planId === "free") {
    return null;
  }

  if (planId === "growth") {
    return currentPlan === "growth"
      ? { label: "Add Members", href: "/settings/members" }
      : { label: "Upgrade Now", href: "/settings/subscription" };
  }

  return currentPlan === "enterprise"
    ? null
    : { label: "Contact Sales", href: CONTACT_SALES_URL, isExternal: true };
}

/**
 * The tier one step up from where the organization stands, which is the only
 * card on the row that gets the brand orange.
 *
 * Weight goes to the NEXT step, never to the biggest one: an organization on
 * Growth is being shown Enterprise, and an organization already on Enterprise
 * is being shown nothing, because the row has nothing above them to point at.
 * A deployment on no recognised tier is shown Growth, which is where the
 * comparison's own upgrade action already pointed.
 */
export function getNextPlan(
  currentPlan: ComparisonPlanId | null,
): ComparisonPlanId | null {
  if (currentPlan === "enterprise") return null;
  if (currentPlan === "growth") return "enterprise";
  return "growth";
}

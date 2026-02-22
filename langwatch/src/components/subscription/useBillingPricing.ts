import {
  type Currency,
  type BillingInterval,
  getGrowthSeatPriceCents,
  formatPrice,
} from "./billing-plans";
import { type MemberType } from "~/server/license-enforcement/member-classification";
import { countFullMembers } from "./subscription-types";

interface HasMemberType {
  memberType: MemberType;
}

export function useBillingPricing({
  currency,
  billingPeriod,
  users,
  plannedUsers,
}: {
  currency: Currency;
  billingPeriod: BillingInterval;
  users: HasMemberType[];
  plannedUsers: HasMemberType[];
}) {
  const priceCents = getGrowthSeatPriceCents();
  const seatCents =
    billingPeriod === "annual"
      ? priceCents[currency].annual
      : priceCents[currency].monthly;
  const periodSuffix = billingPeriod === "annual" ? "/yr" : "/mo";

  const totalFullMembers = countFullMembers(users) + countFullMembers(plannedUsers);

  return {
    seatPricePerPeriodCents: seatCents,
    periodSuffix,
    totalFullMembers,
    monthlyEquivalent:
      billingPeriod === "annual"
        ? `${formatPrice(Math.round(seatCents / 12), currency)}/mo per seat`
        : `${formatPrice(seatCents, currency)}/mo per seat`,
  };
}

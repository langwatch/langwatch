import {
  type Currency,
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
  billingPeriod: "monthly" | "annually";
  users: HasMemberType[];
  plannedUsers: HasMemberType[];
}) {
  const priceCents = getGrowthSeatPriceCents();
  const seatCents =
    billingPeriod === "annually"
      ? priceCents[currency].annual
      : priceCents[currency].monthly;
  const periodSuffix = billingPeriod === "annually" ? "/yr" : "/mo";

  const totalFullMembers = countFullMembers(users) + countFullMembers(plannedUsers);

  return {
    seatPricePerPeriodCents: seatCents,
    periodSuffix,
    totalFullMembers,
    monthlyEquivalent:
      billingPeriod === "annually"
        ? `${formatPrice(Math.round(seatCents / 12), currency)}/mo per seat`
        : `${formatPrice(seatCents, currency)}/mo per seat`,
  };
}

import {
  type Currency,
  getGrowthSeatPriceCents,
  formatPrice,
} from "./billing-plans";
import { type MemberType } from "~/server/license-enforcement/member-classification";

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

  const existingFullMembers = users.filter(
    (u) => u.memberType === "FullMember",
  ).length;
  const plannedFullMembers = plannedUsers.filter(
    (u) => u.memberType === "FullMember",
  ).length;
  const totalFullMembers = existingFullMembers + plannedFullMembers;
  const totalCents = totalFullMembers * seatCents;

  return {
    seatPricePerPeriodCents: seatCents,
    periodSuffix,
    existingFullMembers,
    plannedFullMembers,
    totalFullMembers,
    totalPriceCents: totalCents,
    pricePerSeat: `${formatPrice(seatCents, currency)} per seat${periodSuffix}`,
    totalPriceFormatted: `${formatPrice(totalCents, currency)}${periodSuffix}`,
    monthlyEquivalent:
      billingPeriod === "annually"
        ? `~${formatPrice(Math.round(seatCents / 12), currency)}/seat/mo`
        : null,
  };
}

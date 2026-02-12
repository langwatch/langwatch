import {
  type Currency,
  SEAT_PRICE,
  ANNUAL_DISCOUNT,
  currencySymbol,
} from "./billing-plans";

type MemberType = "core" | "lite";

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
  const sym = currencySymbol[currency];
  const basePrice = SEAT_PRICE[currency];
  const annualSeatPrice = Math.round(basePrice * (1 - ANNUAL_DISCOUNT));
  const seatPrice = billingPeriod === "annually" ? annualSeatPrice : basePrice;

  const existingCoreMembers = users.filter(
    (u) => u.memberType === "core",
  ).length;
  const plannedCoreMembers = plannedUsers.filter(
    (u) => u.memberType === "core",
  ).length;
  const totalCoreMembers = existingCoreMembers + plannedCoreMembers;
  const totalPrice = totalCoreMembers * seatPrice;

  return {
    sym,
    seatPrice,
    existingCoreMembers,
    plannedCoreMembers,
    totalCoreMembers,
    totalPrice,
    pricePerSeat: `${sym}${seatPrice} per seat/mo`,
    totalPriceFormatted: `${sym}${totalPrice}/mo`,
  };
}

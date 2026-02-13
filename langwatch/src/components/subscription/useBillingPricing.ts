import {
  type Currency,
  SEAT_PRICE,
  ANNUAL_DISCOUNT,
  currencySymbol,
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
  const sym = currencySymbol[currency];
  const basePrice = SEAT_PRICE[currency];
  const annualSeatPrice = Math.round(basePrice * (1 - ANNUAL_DISCOUNT));
  const seatPrice = billingPeriod === "annually" ? annualSeatPrice : basePrice;

  const existingFullMembers = users.filter(
    (u) => u.memberType === "FullMember",
  ).length;
  const plannedFullMembers = plannedUsers.filter(
    (u) => u.memberType === "FullMember",
  ).length;
  const totalFullMembers = existingFullMembers + plannedFullMembers;
  const totalPrice = totalFullMembers * seatPrice;

  return {
    sym,
    seatPrice,
    existingFullMembers,
    plannedFullMembers,
    totalFullMembers,
    totalPrice,
    pricePerSeat: `${sym}${seatPrice} per seat/mo`,
    totalPriceFormatted: `${sym}${totalPrice}/mo`,
  };
}

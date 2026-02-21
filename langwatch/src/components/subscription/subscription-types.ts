/**
 * Shared types and helpers for the subscription page components.
 */
import { z } from "zod";
import { type MemberType } from "~/server/license-enforcement/member-classification";
import { type Currency } from "./billing-plans";
import { Currency as PrismaCurrency } from "@prisma/client";

export const isValidEmail = (value: string) => z.string().email().safeParse(value).success;
export const countFullMembers = (list: { memberType: MemberType }[]) =>
  list.filter((u) => u.memberType === "FullMember").length;
export const isSupportedCurrency = (value: unknown): value is Currency =>
  value === PrismaCurrency.EUR || value === PrismaCurrency.USD;

/**
 * User representation in the subscription context
 */
export interface SubscriptionUser {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  memberType: MemberType;
  status?: "active" | "pending";
}

/**
 * Planned user for upgrade (ephemeral, not saved to DB)
 */
export interface PlannedUser {
  id: string;
  email: string;
  memberType: MemberType;
}

/**
 * Pending invite with classified member type for display in the drawer
 */
export interface PendingInviteWithMemberType {
  id: string;
  email: string;
  memberType: MemberType;
}

/**
 * Result of saving the drawer — categorizes rows by action type
 */
export interface DrawerSaveResult {
  inviteEmails: string[];       // emails from auto-fill rows (for invite API)
  newSeats: PlannedUser[];      // manually-added rows (for subscription change)
  deletedSeatCount: number;     // auto rows user deleted (for seat reduction)
}

export function formatPlanTypeLabel(planType?: string | null) {
  if (!planType) {
    return "Current plan";
  }

  return planType
    .toLowerCase()
    .split("_")
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");
}

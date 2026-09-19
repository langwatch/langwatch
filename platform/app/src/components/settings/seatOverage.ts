/**
 * Seats filled over what the license covers (ADR-139, section 6).
 *
 * A connected install may go over its licensed seats by the allowance
 * LangWatch signed, and those seats are invoiced at the next quarterly seat
 * true-up. Going over therefore costs money later, so it is said where it
 * happens: on the member list, and on the invitation that causes it.
 *
 * `licensedMembers` is present on the plan only while a lease applies, so with
 * no lease, an expired one, or Connect off there is nothing to say and every
 * function here answers null or false.
 *
 * Spec: specs/self-hosting/connected-services/license-sync.feature
 */

import type { PlanInfo } from "../../../ee/licensing/planInfo";

/** The plan fields this reads, so a caller can pass a narrower object. */
export type SeatOveragePlan = Pick<
  PlanInfo,
  "maxMembers" | "licensedMembers" | "seatOverageAllowance"
>;

export interface SeatOverage {
  readonly licensed: number;
  readonly inUse: number;
  readonly toBeInvoiced: number;
}

/** Where the organization stands against its licensed seats, once it is over. */
export function readSeatOverage({
  plan,
  membersCount,
}: {
  plan: SeatOveragePlan;
  membersCount: number;
}): SeatOverage | null {
  const licensed = plan.licensedMembers;
  if (licensed === undefined || membersCount <= licensed) return null;

  return {
    licensed,
    inUse: membersCount,
    toBeInvoiced: membersCount - licensed,
  };
}

/** Whether the next full member seat is one over the license. */
export function nextSeatIsOverLicense({
  plan,
  membersCount,
}: {
  plan: SeatOveragePlan;
  membersCount: number;
}): boolean {
  const licensed = plan.licensedMembers;
  return licensed !== undefined && membersCount >= licensed;
}

/** The member list's line, once seats are over the license. */
export function seatOverageSentence(overage: SeatOverage): string {
  const seats = overage.toBeInvoiced === 1 ? "seat" : "seats";
  return `${overage.licensed} licensed, ${overage.inUse} in use, ${overage.toBeInvoiced} ${seats} to be invoiced at the next quarterly true-up.`;
}

/** What an admin is told before they send an invitation that goes over. */
export const SEAT_OVER_LICENSE_INVITE_NOTICE =
  "This seat is over the seats your license covers. It will be invoiced at the next quarterly true-up.";

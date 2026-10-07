/**
 * Seat limit state shared by the server usage stats and the billing page.
 * Framework-free and server-free so the client can import it.
 *
 * @see specs/licensing/subscription-page.feature
 */
import type { PlanInfo } from "../../../ee/licensing/planInfo";
import { formatNumber } from "../../utils/formatNumber";

/** Seat limit state for frontend display. */
export type SeatLimitStatus = "ok" | "exceeded";

/** Seats used against seats the plan includes, for one seat type. */
export interface SeatUsage {
  current: number;
  max: number;
  exceeded: boolean;
}

/**
 * Whether the organization uses more seats than its plan includes. This
 * happens after a plan shrinks under an organization that already filled it
 * (cancelled subscription, removed override, backoffice edit back to Free).
 */
export interface SeatLimitInfo {
  status: SeatLimitStatus;
  members: SeatUsage;
  membersLite: SeatUsage;
  message: string;
}

function isUnlimitedSeats(max: number): boolean {
  return max >= Number.MAX_SAFE_INTEGER;
}

function buildSeatUsage({
  current,
  max,
  enforced,
}: {
  current: number;
  max: number;
  enforced: boolean;
}): SeatUsage {
  return {
    current,
    max,
    exceeded: enforced && !isUnlimitedSeats(max) && current > max,
  };
}

function describeSeats({
  count,
  kind,
}: {
  count: number;
  kind: "member" | "Lite Member";
}): string {
  if (count === 0) return `no ${kind} seats`;
  return `${formatNumber(count)} ${kind} ${count === 1 ? "seat" : "seats"}`;
}

/**
 * Builds the seat limit info for an organization.
 *
 * Seats are counted the way enforcement counts them: active members plus
 * open invites, with expired invites left out. A plan from a license is
 * reported as ok, because the license page carries its own over-seats
 * callout, and so is a plan whose limits are overridden.
 */
export function buildSeatLimitInfo({
  plan,
  membersCount,
  membersLiteCount,
}: {
  plan: Pick<
    PlanInfo,
    "planSource" | "maxMembers" | "maxMembersLite" | "overrideAddingLimitations"
  >;
  membersCount: number;
  membersLiteCount: number;
}): SeatLimitInfo {
  const enforced =
    plan.planSource !== "license" && !plan.overrideAddingLimitations;
  const members = buildSeatUsage({
    current: membersCount,
    max: plan.maxMembers,
    enforced,
  });
  const membersLite = buildSeatUsage({
    current: membersLiteCount,
    max: plan.maxMembersLite,
    enforced,
  });

  const over = [
    members.exceeded &&
      `Your organization uses ${describeSeats({ count: members.current, kind: "member" })} and your plan includes ${describeSeats({ count: members.max, kind: "member" })}.`,
    membersLite.exceeded &&
      `Your organization uses ${describeSeats({ count: membersLite.current, kind: "Lite Member" })} and your plan includes ${describeSeats({ count: membersLite.max, kind: "Lite Member" })}.`,
  ].filter((line): line is string => typeof line === "string");

  return {
    status: over.length > 0 ? "exceeded" : "ok",
    members,
    membersLite,
    message: over.join(" "),
  };
}

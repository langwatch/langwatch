import type { Plan, SeatLimitInfo, SeatUsage } from "@langwatch/entitlement-contract";

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
  return { current, max, exceeded: enforced && !isUnlimitedSeats(max) && current > max };
}

function describeSeats({ count, kind }: { count: number; kind: "member" | "Lite Member" }): string {
  if (count === 0) return `no ${kind} seats`;
  return `${count.toLocaleString("en-US")} ${kind} ${count === 1 ? "seat" : "seats"}`;
}

/**
 * Seats are counted the way enforcement counts them: active members plus open
 * invites, expired invites left out. A plan from a license reports ok (the
 * license page has its own over-seats callout), and so does an overridden one.
 * @see specs/licensing/subscription-page.feature
 */
export function buildSeatLimitInfo({
  plan,
  membersCount,
  membersLiteCount,
}: {
  plan: Pick<Plan, "planSource" | "maxMembers" | "maxMembersLite" | "overrideAddingLimitations">;
  membersCount: number;
  membersLiteCount: number;
}): SeatLimitInfo {
  const enforced = plan.planSource !== "license" && !plan.overrideAddingLimitations;
  const members = buildSeatUsage({ current: membersCount, max: plan.maxMembers, enforced });
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

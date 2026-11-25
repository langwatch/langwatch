import type {
  OrganizationUsageLimits,
  PlanUsageLimit,
  UsageStats,
} from "@langwatch/entitlement-contract";
import { UNLIMITED_MESSAGES } from "@langwatch/plans";

/** One limit; `uncapped` is what the cap's own sentinel or the plan's override says. */
function limitOf({
  name,
  max,
  uncapped,
  used,
}: {
  name: PlanUsageLimit["name"];
  max: number;
  uncapped: boolean;
  used: number | null;
}): PlanUsageLimit {
  return { name, cap: uncapped ? null : max, used };
}

/** A monthly allowance enforcement never refuses on: zero, or a catalogue "no cap" sentinel. */
function isUncappedMonthly(max: number): boolean {
  return max === 0 || max >= UNLIMITED_MESSAGES;
}

function isUncappedSeats({ max, lifted }: { max: number; lifted: boolean }): boolean {
  return lifted || max >= Number.MAX_SAFE_INTEGER;
}

/**
 * The plan's code and every limit it sets, from the usage reading the usage page shows. Creation
 * caps appear only where the plan sets one, with no count: their owners count them.
 */
export function usageLimitsOf(usage: UsageStats): OrganizationUsageLimits {
  const plan = usage.activePlan;
  const lifted = plan.overrideAddingLimitations === true;
  const creationCaps: [PlanUsageLimit["name"], number | undefined][] = [
    ["scenarios", plan.maxScenarios],
    ["scenario_suites", plan.maxScenarioSets],
    ["evaluators", plan.maxEvaluators],
  ];
  const seats: [PlanUsageLimit["name"], number, number][] = [
    ["members", plan.maxMembers, usage.membersCount],
    ["members_lite", plan.maxMembersLite, usage.membersLiteCount],
    ["members_developer", plan.maxMembersDeveloper, usage.membersDeveloperCount],
  ];
  return {
    plan: plan.type,
    limits: [
      limitOf({
        name: usage.usageUnit === "events" ? "events_per_month" : "traces_per_month",
        max: plan.maxMessagesPerMonth,
        uncapped: isUncappedMonthly(plan.maxMessagesPerMonth),
        used: usage.currentMonthMessagesCount,
      }),
      ...seats.map(([name, max, used]) =>
        limitOf({ name, max, uncapped: isUncappedSeats({ max, lifted }), used }),
      ),
      ...creationCaps.flatMap(([name, max]) =>
        max === undefined || lifted ? [] : [{ name, cap: max, used: null }],
      ),
    ],
  };
}

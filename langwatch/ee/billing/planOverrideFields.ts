import type { Subscription } from "@prisma/client";
import type { PlanInfo } from "../licensing/planInfo";

/** Fields that exist on both PlanInfo (as number) and Subscription (as Int?). */
type NumericOverrideField = {
  [K in keyof PlanInfo & keyof Subscription]: PlanInfo[K] extends number
    ? K
    : never;
}[keyof PlanInfo & keyof Subscription];

export const NUMERIC_OVERRIDE_FIELDS = [
  "maxMembers",
  "maxMembersLite",
  "maxProjects",
  "maxMessagesPerMonth",
  "evaluationsCredit",
  "maxWorkflows",
  "maxTeams",
  "maxPrompts",
  "maxEvaluators",
  "maxScenarios",
  "maxAgents",
  "maxExperiments",
  "maxOnlineEvaluations",
  "maxDatasets",
  "maxDashboards",
  "maxCustomGraphs",
  "maxAutomations",
] as const satisfies readonly NumericOverrideField[];

export type { NumericOverrideField };

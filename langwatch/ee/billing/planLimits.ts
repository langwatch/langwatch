import type { PlanInfo } from "../licensing/planInfo";
import { PlanTypes, type PlanTypes as PlanType } from "./planTypes";

const PAID_FEATURES = {
  maxWorkflows: 9999,
  maxPrompts: 9999,
  maxEvaluators: 9999,
  maxScenarios: 9999,
  maxExperiments: 9999,
  maxOnlineEvaluations: 9999,
  maxAgents: 9999,
  maxTeams: 9999,
  maxMembersLite: 9999,
  maxDatasets: 9999,
  maxDashboards: 9999,
  maxCustomGraphs: 9999,
  maxAutomations: 9999,
  canPublish: true,
} as const;

type PlanOverrides = Pick<
  PlanInfo,
  | "type"
  | "name"
  | "maxMembers"
  | "maxProjects"
  | "maxMessagesPerMonth"
  | "evaluationsCredit"
  | "prices"
> &
  Partial<Omit<PlanInfo, "free">>;

const definePaidPlan = (overrides: PlanOverrides): PlanInfo => ({
  free: false,
  ...PAID_FEATURES,
  ...overrides,
});

const withAnnualVariant = ({
  basePlan,
  type,
  name,
  prices,
}: {
  basePlan: PlanInfo;
  type: PlanType;
  name: string;
  prices: PlanInfo["prices"];
}): PlanInfo => ({
  ...basePlan,
  type,
  name,
  prices,
});

const LAUNCH_PLAN = definePaidPlan({
  type: PlanTypes.LAUNCH,
  name: "Launch",
  maxMembers: 3,
  maxProjects: 99,
  maxMessagesPerMonth: 20_000,
  evaluationsCredit: 10,
  prices: {
    USD: 59,
    EUR: 59,
  },
});

const ACCELERATE_PLAN = definePaidPlan({
  type: PlanTypes.ACCELERATE,
  name: "Accelerate",
  maxMembers: 5,
  maxProjects: 99,
  maxMessagesPerMonth: 20_000,
  evaluationsCredit: 10,
  prices: {
    USD: 199,
    EUR: 199,
  },
});

export const PLAN_LIMITS: Record<PlanType, PlanInfo> = {
  [PlanTypes.FREE]: {
    type: PlanTypes.FREE,
    name: "Free",
    free: true,
    maxMembers: 2,
    maxProjects: 1,
    maxMessagesPerMonth: 1000,
    maxWorkflows: 3,
    maxPrompts: 3,
    maxEvaluators: 3,
    maxScenarios: 3,
    maxExperiments: 3,
    maxOnlineEvaluations: 3,
    maxAgents: 3,
    maxTeams: 1,
    maxMembersLite: 0,
    maxDatasets: 3,
    maxDashboards: 3,
    maxCustomGraphs: 3,
    maxAutomations: 3,
    evaluationsCredit: 2,
    canPublish: true,
    prices: {
      USD: 0,
      EUR: 0,
    },
  },
  [PlanTypes.PRO]: definePaidPlan({
    type: PlanTypes.PRO,
    name: "Pro",
    maxMembers: 5,
    maxProjects: 9999,
    maxMessagesPerMonth: 10_000,
    evaluationsCredit: 10,
    prices: {
      USD: 99,
      EUR: 99,
    },
  }),
  [PlanTypes.LAUNCH]: LAUNCH_PLAN,
  [PlanTypes.LAUNCH_ANNUAL]: withAnnualVariant({
    basePlan: LAUNCH_PLAN,
    type: PlanTypes.LAUNCH_ANNUAL,
    name: "Launch Annual",
    prices: {
      USD: 649,
      EUR: 649,
    },
  }),
  [PlanTypes.ACCELERATE]: ACCELERATE_PLAN,
  [PlanTypes.ACCELERATE_ANNUAL]: withAnnualVariant({
    basePlan: ACCELERATE_PLAN,
    type: PlanTypes.ACCELERATE_ANNUAL,
    name: "Accelerate Annual",
    prices: {
      USD: 2199,
      EUR: 2199,
    },
  }),
  [PlanTypes.GROWTH]: definePaidPlan({
    type: PlanTypes.GROWTH,
    name: "Growth",
    maxMembers: 10,
    maxProjects: 99,
    maxMessagesPerMonth: 100_000,
    evaluationsCredit: 50,
    prices: {
      USD: 399,
      EUR: 399,
    },
  }),
  [PlanTypes.ENTERPRISE]: definePaidPlan({
    type: PlanTypes.ENTERPRISE,
    name: "Enterprise",
    maxMembers: 1000,
    maxProjects: 9999,
    maxMessagesPerMonth: 1_000_000,
    evaluationsCredit: 500,
    prices: {
      USD: 999,
      EUR: 999,
    },
  }),
};

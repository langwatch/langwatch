import type { PlanGates } from "./gates.ts";
import { ENTERPRISE_CAPABILITIES } from "./gates.ts";
import type { PlanLimits } from "./limits.ts";
import { UNLIMITED, UNLIMITED_MESSAGES } from "./limits.ts";
import type { MoneyByCurrency, PlanType } from "./plan-type.ts";
import type { Plan } from "./plan.ts";

const NO_ENTERPRISE_GATES: PlanGates = {
  canPublish: true,
  webhookEndpoints: false,
  rbac: false,
  auditLogs: false,
  scim: false,
  anomalyRules: false,
  activityMonitor: false,
  ingestionSources: false,
  ocsfExport: false,
  managementApi: false,
  groups: false,
};

const ALL_GATES: PlanGates = {
  ...NO_ENTERPRISE_GATES,
  ...(Object.fromEntries(
    ENTERPRISE_CAPABILITIES.map((capability) => [capability, true]),
  ) as Partial<PlanGates>),
};

/** Lite seats are uncapped on every paid cloud plan; the free tier sells none. */
const PAID_MEMBERS_LITE = 9_999;

function tieredLimits({
  automationDailyDispatch,
  members,
  volume,
}: {
  automationDailyDispatch: number;
  members: number;
  volume: number;
}): PlanLimits {
  return {
    members: { value: members, unit: "members" },
    membersLite: { value: PAID_MEMBERS_LITE, unit: "members" },
    volume: { value: volume, unit: "messages-per-month" },
    seats: null,
    automationDailyDispatch: { value: automationDailyDispatch, unit: "dispatches-per-day" },
    visibility: null,
  };
}

function tieredPlan({
  automationDailyDispatch,
  members,
  name,
  order,
  period,
  prices,
  rung,
  type,
  volume,
}: {
  automationDailyDispatch: number;
  members: number;
  name: string;
  order: number;
  period: "monthly" | "annual";
  prices: MoneyByCurrency;
  rung: PlanType;
  type: PlanType;
  volume: number;
}): Plan {
  return {
    type,
    name,
    free: false,
    storedAsPlanType: true,
    accountManaged: false,
    pricing: { model: "TIERED", period, prices, seatPrice: null },
    limits: tieredLimits({ automationDailyDispatch, members, volume }),
    gates: NO_ENTERPRISE_GATES,
    selfServe: { ladder: "TIERED", rung, order },
    disputed: [],
  };
}

const GROWTH_SEAT_RUNG: PlanType = "GROWTH_SEAT_EUR_MONTHLY";

function growthSeatPlan({ period, type }: { period: "monthly" | "annual"; type: PlanType }): Plan {
  return {
    type,
    name: "Growth",
    free: false,
    storedAsPlanType: true,
    accountManaged: false,
    pricing: {
      model: "SEAT_EVENT",
      period,
      prices: { USD: 0, EUR: 0 },
      seatPrice: { USD: 32, EUR: 29 },
    },
    limits: {
      members: { value: 20, unit: "members" },
      membersLite: { value: PAID_MEMBERS_LITE, unit: "members" },
      volume: { value: UNLIMITED_MESSAGES, unit: "events-per-month" },
      seats: { value: 20, unit: "seats" },
      automationDailyDispatch: { value: 500, unit: "dispatches-per-day" },
      visibility: null,
    },
    gates: NO_ENTERPRISE_GATES,
    selfServe: { ladder: "SEAT_EVENT", rung: GROWTH_SEAT_RUNG, order: 0 },
    disputed: [],
  };
}

const FREE_PLAN: Plan = {
  type: "FREE",
  name: "Free",
  free: true,
  storedAsPlanType: true,
  accountManaged: false,
  pricing: { model: "TIERED", period: "monthly", prices: { USD: 0, EUR: 0 }, seatPrice: null },
  limits: {
    members: { value: 2, unit: "members" },
    membersLite: { value: 0, unit: "members" },
    volume: { value: 50_000, unit: "messages-per-month" },
    seats: null,
    automationDailyDispatch: { value: 50, unit: "dispatches-per-day" },
    visibility: { value: 14, unit: "days" },
  },
  gates: NO_ENTERPRISE_GATES,
  selfServe: null,
  disputed: ["free-plan-two-definitions"],
};

const ENTERPRISE_PLAN: Plan = {
  type: "ENTERPRISE",
  name: "Enterprise",
  free: false,
  storedAsPlanType: true,
  accountManaged: true,
  pricing: {
    model: "TIERED",
    period: "monthly",
    prices: { USD: 999, EUR: 999 },
    seatPrice: null,
  },
  limits: tieredLimits({ automationDailyDispatch: 5_000, members: 1_000, volume: 1_000_000 }),
  gates: ALL_GATES,
  selfServe: null,
  disputed: [],
};

/**
 * The plan a self-hosted deployment runs on with no licence. A licence sells
 * the Enterprise surface and support, not permission to run the software, so
 * nothing the deployment keeps on its own infrastructure is capped here.
 */
const OPEN_SOURCE_PLAN: Plan = {
  type: "OPEN_SOURCE",
  name: "Open Source",
  free: true,
  storedAsPlanType: false,
  accountManaged: true,
  pricing: { model: null, period: "none", prices: { USD: 0, EUR: 0 }, seatPrice: null },
  limits: {
    members: { value: UNLIMITED, unit: "members" },
    membersLite: { value: UNLIMITED, unit: "members" },
    volume: { value: UNLIMITED, unit: "messages-per-month" },
    seats: null,
    automationDailyDispatch: { value: UNLIMITED, unit: "dispatches-per-day" },
    visibility: null,
  },
  gates: NO_ENTERPRISE_GATES,
  selfServe: null,
  disputed: [],
};

const PRO_PLAN: Plan = {
  ...tieredPlan({
    automationDailyDispatch: 500,
    members: 5,
    name: "Pro",
    order: 0,
    period: "monthly",
    prices: { USD: 99, EUR: 99 },
    rung: "PRO",
    type: "PRO",
    volume: 10_000,
  }),
  disputed: ["pro-volume-below-free"],
};

const GROWTH_PLAN: Plan = {
  ...tieredPlan({
    automationDailyDispatch: 500,
    members: 10,
    name: "Growth",
    order: 3,
    period: "monthly",
    prices: { USD: 399, EUR: 399 },
    rung: "GROWTH",
    type: "GROWTH",
    volume: 100_000,
  }),
  disputed: ["growth-copy-volume"],
};

export const PLANS: Readonly<Record<PlanType, Plan>> = Object.freeze({
  FREE: FREE_PLAN,
  PRO: PRO_PLAN,
  LAUNCH: tieredPlan({
    automationDailyDispatch: 150,
    members: 3,
    name: "Launch",
    order: 1,
    period: "monthly",
    prices: { USD: 59, EUR: 59 },
    rung: "LAUNCH",
    type: "LAUNCH",
    volume: 20_000,
  }),
  LAUNCH_ANNUAL: tieredPlan({
    automationDailyDispatch: 150,
    members: 3,
    name: "Launch Annual",
    order: 1,
    period: "annual",
    prices: { USD: 649, EUR: 649 },
    rung: "LAUNCH",
    type: "LAUNCH_ANNUAL",
    volume: 20_000,
  }),
  ACCELERATE: tieredPlan({
    automationDailyDispatch: 300,
    members: 5,
    name: "Accelerate",
    order: 2,
    period: "monthly",
    prices: { USD: 199, EUR: 199 },
    rung: "ACCELERATE",
    type: "ACCELERATE",
    volume: 20_000,
  }),
  ACCELERATE_ANNUAL: tieredPlan({
    automationDailyDispatch: 300,
    members: 5,
    name: "Accelerate Annual",
    order: 2,
    period: "annual",
    prices: { USD: 2_199, EUR: 2_199 },
    rung: "ACCELERATE",
    type: "ACCELERATE_ANNUAL",
    volume: 20_000,
  }),
  GROWTH: GROWTH_PLAN,
  GROWTH_SEAT_EUR_MONTHLY: growthSeatPlan({ period: "monthly", type: "GROWTH_SEAT_EUR_MONTHLY" }),
  GROWTH_SEAT_EUR_ANNUAL: growthSeatPlan({ period: "annual", type: "GROWTH_SEAT_EUR_ANNUAL" }),
  GROWTH_SEAT_USD_MONTHLY: growthSeatPlan({ period: "monthly", type: "GROWTH_SEAT_USD_MONTHLY" }),
  GROWTH_SEAT_USD_ANNUAL: growthSeatPlan({ period: "annual", type: "GROWTH_SEAT_USD_ANNUAL" }),
  ENTERPRISE: ENTERPRISE_PLAN,
  OPEN_SOURCE: OPEN_SOURCE_PLAN,
});

/** The plan each deployment starts from before any contract is applied. */
export const BASELINES: Readonly<Record<"cloud" | "self-hosted", Plan>> = Object.freeze({
  cloud: FREE_PLAN,
  "self-hosted": OPEN_SOURCE_PLAN,
});

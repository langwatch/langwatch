/**
 * Self-serve ladder from PLAN_LIMITS with annual collapsed to monthly. Lives in
 * billing because prices and tiers are billing's fact.
 */
import {
  GROWTH_SEAT_PLAN_TYPES,
  PLAN_LIMITS,
  PlanTypes,
} from "@langwatch/enterprise-billing-contract";
import type { PricingModel } from "@langwatch/entitlement-contract";
import { type CataloguePlan, type PlanCatalogueReader } from "@langwatch/entitlement-server";

function catalogueRung(representative: PlanTypes, types: readonly PlanTypes[]): CataloguePlan {
  const plan = PLAN_LIMITS[representative];
  const pricedPerSeat = plan.userPrice !== undefined;

  return {
    tier: representative,
    types,
    name: plan.name,
    monthlyPrice: pricedPerSeat ? plan.userPrice! : plan.prices,
    pricedPerSeat,
    maxMessagesPerMonth: plan.maxMessagesPerMonth,
    maxMembers: plan.maxMembers,
    // Every plan on a ladder listed below sets its own ceiling in PLAN_LIMITS;
    // the assertion mirrors userPrice above.
    automationDailyDispatchCeiling: plan.automationDailyDispatchCeiling!,
  };
}

const TIERED_LADDER: readonly CataloguePlan[] = [
  catalogueRung(PlanTypes.PRO, [PlanTypes.PRO]),
  catalogueRung(PlanTypes.LAUNCH, [PlanTypes.LAUNCH, PlanTypes.LAUNCH_ANNUAL]),
  catalogueRung(PlanTypes.ACCELERATE, [PlanTypes.ACCELERATE, PlanTypes.ACCELERATE_ANNUAL]),
  catalogueRung(PlanTypes.GROWTH, [PlanTypes.GROWTH]),
];

const SEAT_EVENT_LADDER: readonly CataloguePlan[] = [
  catalogueRung(GROWTH_SEAT_PLAN_TYPES[0], GROWTH_SEAT_PLAN_TYPES),
];

/** The self-serve ladder, as `PLAN_LIMITS` already defines it. No price is invented here. */
export class PlanLimitsCatalogueService implements PlanCatalogueReader {
  static create(): PlanLimitsCatalogueService {
    return new PlanLimitsCatalogueService();
  }

  private constructor() {}

  listSelfServePlans(input: {
    pricingModel: PricingModel | null;
  }): Promise<readonly CataloguePlan[]> {
    return Promise.resolve(input.pricingModel === "SEAT_EVENT" ? SEAT_EVENT_LADDER : TIERED_LADDER);
  }
}

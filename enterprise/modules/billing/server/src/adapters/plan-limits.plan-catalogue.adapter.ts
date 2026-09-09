/**
 * The self-serve ladder `PlanNextStepService` ranks, read off `PLAN_LIMITS` — the same
 * static table every plan in this deployment is priced from. Annual variants are
 * collapsed onto their monthly rung here, since that grouping is this catalogue's own
 * fact and not a policy the next-step service should have to know.
 *
 * The seat-priced ladder (`SEAT_EVENT`) has one rung: an organization already on it has
 * nowhere self-serve to move to, so its next step correctly resolves to "none".
 *
 * It lives in billing rather than in entitlement because the ladder is billing's — the
 * prices, the tiers and the annual groupings are all `PLAN_LIMITS`, which this package
 * owns. Every process that offers an organization a next step composes this one adapter,
 * so an upgrade line in an automation-ceiling mail and one in a usage-limit mail cannot
 * disagree about what the next tier costs.
 */
import {
  GROWTH_SEAT_PLAN_TYPES,
  PLAN_LIMITS,
  PlanTypes,
} from "@langwatch/enterprise-billing-contract";
import type { PricingModel } from "@langwatch/entitlement-contract";
import { type CataloguePlan, PlanCataloguePort } from "@langwatch/entitlement-server";

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
export class PlanLimitsPlanCatalogueAdapter extends PlanCataloguePort {
  static create(): PlanLimitsPlanCatalogueAdapter {
    return new PlanLimitsPlanCatalogueAdapter();
  }

  private constructor() {
    super();
  }

  listSelfServePlans(input: {
    pricingModel: PricingModel | null;
  }): Promise<readonly CataloguePlan[]> {
    return Promise.resolve(input.pricingModel === "SEAT_EVENT" ? SEAT_EVENT_LADDER : TIERED_LADDER);
  }
}

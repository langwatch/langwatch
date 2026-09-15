import { BASELINES, PLANS } from "./catalogue-data.ts";
import type { PlanDispute } from "./disputes.ts";
import { PLAN_DISPUTES } from "./disputes.ts";
import type { PlanCapability } from "./gates.ts";
import type { PlanLimit } from "./limits.ts";
import type { Deployment, MoneyByCurrency, PlanType, PricingModel } from "./plan-type.ts";
import { PLAN_TYPES } from "./plan-type.ts";
import type { Plan } from "./plan.ts";

/**
 * One step of the self-serve ladder. Annual variants are collapsed onto the
 * monthly rung they are the same plan as, so `types` can hold more than one.
 */
export type PlanRung = {
  tier: PlanType;
  types: readonly PlanType[];
  name: string;
  order: number;
  monthlyPrice: MoneyByCurrency;
  pricedPerSeat: boolean;
  volume: PlanLimit;
  members: PlanLimit;
  automationDailyDispatch: PlanLimit;
};

const ALL_PLANS: readonly Plan[] = Object.freeze(PLAN_TYPES.map((type) => PLANS[type]));

function rungOfLadder(ladder: PricingModel): readonly PlanRung[] {
  const representatives = ALL_PLANS.filter(
    (plan) => plan.selfServe?.ladder === ladder && plan.selfServe.rung === plan.type,
  );

  return Object.freeze(
    representatives.map((plan) => buildRung(plan)).sort((left, right) => left.order - right.order),
  );
}

function buildRung(plan: Plan): PlanRung {
  const placement = plan.selfServe;
  if (!placement) throw new Error(`${plan.type} is not on a self-serve ladder`);

  const seatPrice = plan.pricing.seatPrice;

  return {
    tier: plan.type,
    types: Object.freeze(
      ALL_PLANS.filter((other) => other.selfServe?.rung === plan.type).map((other) => other.type),
    ),
    name: plan.name,
    order: placement.order,
    monthlyPrice: seatPrice ?? plan.pricing.prices,
    pricedPerSeat: seatPrice !== null,
    volume: plan.limits.volume,
    members: plan.limits.members,
    automationDailyDispatch: plan.limits.automationDailyDispatch,
  };
}

const LADDERS: Readonly<Record<PricingModel, readonly PlanRung[]>> = Object.freeze({
  TIERED: rungOfLadder("TIERED"),
  SEAT_EVENT: rungOfLadder("SEAT_EVENT"),
});

/**
 * Every plan fact the product quotes, asked the way `PlanNextStepService`
 * already asks it. The catalogue answers "what is the number"; whether a
 * particular request may proceed stays with the feature that refuses it.
 */
export const planCatalogue = {
  all(): readonly Plan[] {
    return ALL_PLANS;
  },

  /** Total: every `PlanType` has an entry, so a caller never handles undefined. */
  plan(type: PlanType): Plan {
    return PLANS[type];
  },

  /** The plan a deployment resolves to before any subscription or licence. */
  baseline(deployment: Deployment): Plan {
    return BASELINES[deployment];
  },

  rungs({ pricingModel }: { pricingModel: PricingModel | null }): readonly PlanRung[] {
    return LADDERS[pricingModel === "SEAT_EVENT" ? "SEAT_EVENT" : "TIERED"];
  },

  rungOf({ pricingModel, type }: { pricingModel: PricingModel | null; type: PlanType }) {
    return planCatalogue.rungs({ pricingModel }).find((rung) => rung.types.includes(type));
  },

  /** The next rung up, by metered volume, or undefined at the top. */
  above({ pricingModel, type }: { pricingModel: PricingModel | null; type: PlanType }) {
    const ladder = planCatalogue.rungs({ pricingModel });
    const current = ladder.find((rung) => rung.types.includes(type));
    if (!current) return undefined;

    return ladder
      .filter((rung) => rung.volume.value > current.volume.value)
      .sort((left, right) => left.volume.value - right.volume.value)[0];
  },

  /** A plan a person sells. Never quoted as a self-serve next step. */
  isAccountManaged(type: PlanType): boolean {
    return PLANS[type].accountManaged;
  },

  gate(type: PlanType, capability: PlanCapability): boolean {
    return PLANS[type].gates[capability];
  },

  /** Facts two definitional sites still state differently. */
  disputes(): readonly PlanDispute[] {
    return PLAN_DISPUTES;
  },

  disputesFor(type: PlanType): readonly PlanDispute[] {
    return PLAN_DISPUTES.filter((dispute) => dispute.subjects.includes(type));
  },
};

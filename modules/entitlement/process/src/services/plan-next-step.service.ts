import {
  isAccountManagedPlan,
  type Plan,
  type PlanNextStep,
  type PricingModel,
} from "@langwatch/entitlement-contract";
import { planNextStepCeilingsOf } from "@langwatch/plans";

import type { PlanCatalogueReader } from "../app/entitlement.app.ts";

/**
 * Determines what an organization is told about where it goes next. Based on the
 * organization's plan and pricing model; every hook asks it rather than deciding.
 */
export class PlanNextStepService {
  static create(options: { catalogue: PlanCatalogueReader }): PlanNextStepService {
    return new PlanNextStepService(options.catalogue);
  }

  private constructor(private readonly catalogue: PlanCatalogueReader) {}

  /**
   * Next step for this organization in its currency. Account-managed is decided first from
   * three facts: licence-origin, custom limits, or non-self-serve tier.
   */
  async resolve(input: {
    plan: Plan;
    pricingModel: PricingModel | null;
    currency?: "USD" | "EUR";
  }): Promise<PlanNextStep> {
    const currency = input.currency ?? "USD";
    const ladder = await this.catalogue.listSelfServePlans({ pricingModel: input.pricingModel });
    const current = ladder.find((rung) => rung.types.includes(input.plan.type));

    if (isAccountManagedPlan(input.plan) || !current) {
      return { kind: "account_team" };
    }

    const above = ladder
      .filter((rung) => rung.maxMessagesPerMonth > current.maxMessagesPerMonth)
      .toSorted((a, b) => a.maxMessagesPerMonth - b.maxMessagesPerMonth)[0];
    if (!above) {
      return { kind: "none" };
    }

    return {
      kind: "self_serve",
      tier: above.tier,
      name: above.name,
      monthlyPrice: above.monthlyPrice[currency],
      currency,
      pricedPerSeat: above.pricedPerSeat,
      ...planNextStepCeilingsOf(above),
    };
  }
}

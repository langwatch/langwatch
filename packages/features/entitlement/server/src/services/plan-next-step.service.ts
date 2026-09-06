import {
  isAccountManagedPlan,
  type Plan,
  type PlanNextStep,
  type PricingModel,
} from "@langwatch/entitlement-contract";
import type { PlanCataloguePort } from "../ports/plan-catalogue.port";

/**
 * What an organization may truthfully be told about where it goes next.
 *
 * This exists because a growth line in a transactional message is a claim about
 * a particular organization's money, and the ways of getting that wrong all
 * look the same from inside a template: a static plan-to-price map quotes the
 * list at somebody who negotiated, an annual variant reads as a rung above the
 * monthly one it is the same as, and a plan nobody sells self-serve reads as a
 * plan the reader could buy this afternoon.
 *
 * So the decision is made once, here, from the organization's own plan and its
 * own pricing model, and every hook that names a plan, a price or a ceiling
 * asks it rather than deciding for itself.
 */
export class PlanNextStepService {
  static create(options: { catalogue: PlanCataloguePort }): PlanNextStepService {
    return new PlanNextStepService(options.catalogue);
  }

  private constructor(private readonly catalogue: PlanCataloguePort) {}

  /**
   * The next step for this organization, in the currency it is quoted in.
   *
   * Account-managed is decided first and from three facts, any one of which is
   * enough: the plan came from a licence, the plan carries an override on its
   * own limits, or the plan's tier is not one of the ones sold self-serve. The
   * last is what catches enterprise under both pricings without either being
   * named here — a tier a person sells is a tier absent from the catalogue —
   * and it is why an annual variant resolves to the rung it belongs to rather
   * than to nothing.
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
      .sort((a, b) => a.maxMessagesPerMonth - b.maxMessagesPerMonth)[0];
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
      maxMessagesPerMonth: above.maxMessagesPerMonth,
      maxMembers: above.maxMembers,
    };
  }
}

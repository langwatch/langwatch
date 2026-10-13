import type { PricingModel } from "@langwatch/entitlement-contract";
import { planCatalogue, type PlanRung } from "@langwatch/plans";

import type { CataloguePlan, PlanCatalogueReader } from "../app/entitlement.app.ts";

function cataloguePlanOf(rung: PlanRung): CataloguePlan {
  return {
    tier: rung.tier,
    types: rung.types,
    name: rung.name,
    monthlyPrice: rung.monthlyPrice,
    pricedPerSeat: rung.pricedPerSeat,
    maxMessagesPerMonth: rung.volume.value,
    maxMembers: rung.members.value,
    automationDailyDispatchCeiling: rung.automationDailyDispatch.value,
  };
}

/** The self-serve ladder as `@langwatch/plans` defines it, rung for rung. */
export class SelfServePlanCatalogueService implements PlanCatalogueReader {
  static create(): SelfServePlanCatalogueService {
    return new SelfServePlanCatalogueService();
  }

  private constructor() {}

  listSelfServePlans(input: {
    pricingModel: PricingModel | null;
  }): Promise<readonly CataloguePlan[]> {
    return Promise.resolve(
      planCatalogue.rungs({ pricingModel: input.pricingModel }).map(cataloguePlanOf),
    );
  }
}

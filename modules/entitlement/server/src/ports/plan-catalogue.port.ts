import type { PricingModel } from "@langwatch/entitlement-contract";

/**
 * One plan an organization can buy for itself, as the ladder lists it.
 *
 * Annual and monthly variants of one tier are the same rung: an organization
 * already on Accelerate is not offered Accelerate Annual as its next step, and
 * an organization below Accelerate is offered the tier and not a billing
 * period. Collapsing them is the adapter's job, because which types are
 * variants of which is the catalogue's own fact.
 */
export interface CataloguePlan {
  /** The tier, monthly and annual variants collapsed onto one. */
  tier: string;
  /**
   * Every plan type that sits on this rung, the tier itself included.
   *
   * The mapping is the catalogue's own fact and lives with it: which types are
   * billing periods of one tier, and which are currency cuts of it, is not
   * something a policy can work out from a name without eventually being wrong
   * about one.
   */
  types: readonly string[];
  name: string;
  /** A whole monthly amount by currency, per seat when `pricedPerSeat`. */
  monthlyPrice: Readonly<Record<"USD" | "EUR", number>>;
  pricedPerSeat: boolean;
  maxMessagesPerMonth: number;
  maxMembers: number;
  /** Confirmed matches a day one automation may act on, on this rung. */
  automationDailyDispatchCeiling: number;
}

/**
 * The plans an organization may buy without talking to anybody.
 *
 * Deliberately only the self-serve ones. A tier sold by a person — enterprise
 * in either of its pricings — is absent from this list on purpose, and its
 * absence is what tells the next-step policy that an organization on it is
 * account-managed. There is no flag to forget to set.
 *
 * A port rather than a constant because the ladder is billing's, and the
 * organization's pricing model decides which rungs are on it.
 */
export abstract class PlanCataloguePort {
  abstract listSelfServePlans(input: {
    pricingModel: PricingModel | null;
  }): Promise<readonly CataloguePlan[]>;
}

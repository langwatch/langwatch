import {
  BillingPriceCatalogue,
  type Currency,
  getAnnualDiscountPercent,
  getGrowthSeatPriceCents,
  type StripeEnvironment,
} from "@langwatch/enterprise-billing-contract";

/** Browser-safe view over the environment-specific Stripe catalogue. */
export class BillingPricingService {
  private constructor(private readonly catalogue: BillingPriceCatalogue) {}

  static create(environment: StripeEnvironment): BillingPricingService {
    return new BillingPricingService(BillingPriceCatalogue.create(environment));
  }

  getGrowthSeatPriceCents() {
    return getGrowthSeatPriceCents(this.catalogue.prices);
  }

  getAnnualDiscountPercent(currency: Currency): number {
    return getAnnualDiscountPercent(currency, this.catalogue.prices);
  }
}

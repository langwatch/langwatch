import { describe, expect, it } from "vitest";
import { BillingPricingService } from "../billing-pricing.service";

describe("BillingPricingService", () => {
  it("resolves browser prices from the selected catalogue", () => {
    const pricing = BillingPricingService.create("live");

    expect(pricing.getGrowthSeatPriceCents().EUR.monthly).toBe(2_900);
    expect(pricing.getAnnualDiscountPercent("EUR")).toBe(8);
  });
});

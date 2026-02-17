import { describe, expect, it } from "vitest";
import { STRIPE_PRICE_NAMES } from "../stripePrices.types";

describe("stripePrices.types", () => {
  it("defines all required billing price keys", () => {
    const requiredKeys = [
      "PRO",
      "GROWTH",
      "LAUNCH",
      "ACCELERATE",
      "LAUNCH_USERS",
      "ACCELERATE_USERS",
      "LAUNCH_TRACES_10K",
      "ACCELERATE_TRACES_100K",
    ];

    expect(STRIPE_PRICE_NAMES.length).toBeGreaterThanOrEqual(requiredKeys.length);

    for (const key of requiredKeys) {
      expect(STRIPE_PRICE_NAMES).toContain(key);
    }
  });

  it("keeps required billing keys unique", () => {
    expect(new Set(STRIPE_PRICE_NAMES).size).toBe(STRIPE_PRICE_NAMES.length);
  });
});

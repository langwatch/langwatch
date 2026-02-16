import { describe, expect, it } from "vitest";
import { STRIPE_PRICE_NAMES } from "../stripePrices.types";

describe("stripePrices.types", () => {
  it("defines the 14 required billing price keys", () => {
    expect(STRIPE_PRICE_NAMES).toHaveLength(14);
    expect(STRIPE_PRICE_NAMES).toEqual([
      "PRO",
      "GROWTH",
      "LAUNCH",
      "LAUNCH_ANNUAL",
      "ACCELERATE",
      "ACCELERATE_ANNUAL",
      "LAUNCH_USERS",
      "ACCELERATE_USERS",
      "LAUNCH_TRACES_10K",
      "ACCELERATE_TRACES_100K",
      "LAUNCH_ANNUAL_TRACES_10K",
      "ACCELERATE_ANNUAL_TRACES_100K",
      "LAUNCH_ANNUAL_USERS",
      "ACCELERATE_ANNUAL_USERS",
    ]);
  });

  it("keeps required billing keys unique", () => {
    expect(new Set(STRIPE_PRICE_NAMES).size).toBe(STRIPE_PRICE_NAMES.length);
  });
});

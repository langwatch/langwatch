import { describe, expect, it } from "vitest";
import { PlanTypes, SUBSCRIBABLE_PLANS, SubscriptionStatus } from "../index";

describe("SUBSCRIBABLE_PLANS", () => {
  it("includes FREE for downgrade/cancel flow", () => {
    expect(SUBSCRIBABLE_PLANS).toContain(PlanTypes.FREE);
  });

  it("excludes ENTERPRISE from self-serve subscription flows", () => {
    expect(SUBSCRIBABLE_PLANS).not.toContain(PlanTypes.ENTERPRISE);
  });
});

describe("portable enum vocabulary", () => {
  it("keeps the subscription lifecycle values stable", () => {
    expect(Object.values(SubscriptionStatus)).toEqual([
      "PENDING",
      "FAILED",
      "ACTIVE",
      "CANCELLED",
    ]);
  });
});

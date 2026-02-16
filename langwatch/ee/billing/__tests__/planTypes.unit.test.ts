import { describe, expect, it } from "vitest";
import { PlanTypes, SUBSCRIBABLE_PLANS } from "../planTypes";

describe("SUBSCRIBABLE_PLANS", () => {
  it("includes FREE for downgrade/cancel flow", () => {
    expect(SUBSCRIBABLE_PLANS).toContain(PlanTypes.FREE);
  });

  it("excludes ENTERPRISE from self-serve subscription flows", () => {
    expect(SUBSCRIBABLE_PLANS).not.toContain(PlanTypes.ENTERPRISE);
  });
});

import { describe, expect, expectTypeOf, it } from "vitest";
import { planSchema, type Plan, type PlanProvider } from "../src";

describe("Entitlements contract", () => {
  it("exposes a provider-neutral plan", () => {
    expectTypeOf<
      Awaited<ReturnType<PlanProvider["getActivePlan"]>>
    >().toEqualTypeOf<Plan>();
  });

  it("compiles and validates the provider-neutral plan schema", () => {
    expect(
      planSchema.parse({
        planSource: "free",
        type: "FREE",
        name: "Free",
        free: true,
        maxMessagesPerMonth: 1_000,
        maxMembers: 3,
        maxMembersLite: 0,
        canPublish: false,
        prices: { USD: 0, EUR: 0 },
      }),
    ).toMatchObject({ type: "FREE" });
  });
});

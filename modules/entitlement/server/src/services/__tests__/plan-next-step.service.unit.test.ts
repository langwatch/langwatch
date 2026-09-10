import type { Plan, PricingModel } from "@langwatch/entitlement-contract";
import { describe, expect, it } from "vitest";
import { PlanCatalogueRepository, type CataloguePlan } from "../../repositories/plan-catalogue.repository.ts";
import { PlanNextStepService } from "../plan-next-step.service.ts";

/**
 * Five organizations, because five is how many ways the answer differs: two
 * that buy from a public ladder and get a plan, two on enterprise terms under
 * each of the pricings, and one whose limits were agreed rather than sold.
 */

const TIERED_LADDER: readonly CataloguePlan[] = [
  {
    tier: "FREE",
    types: ["FREE"],
    name: "Free",
    monthlyPrice: { USD: 0, EUR: 0 },
    pricedPerSeat: false,
    maxMessagesPerMonth: 50_000,
    maxMembers: 2,
    automationDailyDispatchCeiling: 50,
  },
  {
    tier: "LAUNCH",
    types: ["LAUNCH", "LAUNCH_ANNUAL"],
    name: "Launch",
    monthlyPrice: { USD: 59, EUR: 59 },
    pricedPerSeat: false,
    maxMessagesPerMonth: 100_000,
    maxMembers: 3,
    automationDailyDispatchCeiling: 150,
  },
  {
    tier: "ACCELERATE",
    types: ["ACCELERATE", "ACCELERATE_ANNUAL"],
    name: "Accelerate",
    monthlyPrice: { USD: 199, EUR: 199 },
    pricedPerSeat: false,
    maxMessagesPerMonth: 500_000,
    maxMembers: 5,
    automationDailyDispatchCeiling: 300,
  },
];

const SEAT_EVENT_LADDER: readonly CataloguePlan[] = [
  {
    tier: "FREE",
    types: ["FREE"],
    name: "Free",
    monthlyPrice: { USD: 0, EUR: 0 },
    pricedPerSeat: false,
    maxMessagesPerMonth: 50_000,
    maxMembers: 2,
    automationDailyDispatchCeiling: 50,
  },
  {
    tier: "GROWTH_SEAT",
    types: [
      "GROWTH_SEAT_USD_MONTHLY",
      "GROWTH_SEAT_USD_ANNUAL",
      "GROWTH_SEAT_EUR_MONTHLY",
      "GROWTH_SEAT_EUR_ANNUAL",
    ],
    name: "Growth",
    monthlyPrice: { USD: 32, EUR: 29 },
    pricedPerSeat: true,
    maxMessagesPerMonth: 999_999_999,
    maxMembers: 20,
    automationDailyDispatchCeiling: 500,
  },
];

class FixedCatalogue extends PlanCatalogueRepository {
  constructor(private readonly bySeatEvent: boolean) {
    super();
  }

  async listSelfServePlans(input: {
    pricingModel: PricingModel | null;
  }): Promise<readonly CataloguePlan[]> {
    return input.pricingModel === "SEAT_EVENT" || this.bySeatEvent
      ? SEAT_EVENT_LADDER
      : TIERED_LADDER;
  }
}

const planOf = (overrides: Partial<Plan>): Plan => ({
  planSource: "subscription",
  type: "FREE",
  name: "Free",
  free: false,
  maxMembers: 2,
  maxMembersLite: 0,
  maxMessagesPerMonth: 50_000,
  canPublish: true,
  prices: { USD: 0, EUR: 0 },
  ...overrides,
});

const service = PlanNextStepService.create({ catalogue: new FixedCatalogue(false) });

describe("given an organization buying from the public tiered ladder", () => {
  describe("when it sits below the top rung", () => {
    /** @scenario "A tiered organization is offered the next rung and its price" */
    it("names the next rung up and its monthly price", async () => {
      const step = await service.resolve({
        plan: planOf({ type: "FREE", planSource: "free", free: true }),
        pricingModel: "TIERED",
      });

      expect(step).toEqual({
        kind: "self_serve",
        tier: "LAUNCH",
        name: "Launch",
        monthlyPrice: 59,
        currency: "USD",
        pricedPerSeat: false,
        maxMessagesPerMonth: 100_000,
        maxMembers: 3,
        automationDailyDispatchCeiling: 150,
      });
    });
  });

  describe("when a tiered organization's next step is priced", () => {
    /** @scenario "The next rung names its automation ceiling too" */
    it("carries the daily automation ceiling the next rung sells", async () => {
      const step = await service.resolve({
        plan: planOf({ type: "FREE", planSource: "free", free: true }),
        pricingModel: "TIERED",
      });

      expect(step).toMatchObject({ automationDailyDispatchCeiling: 150 });
    });
  });

  describe("when it is already on the top rung", () => {
    /** @scenario "An organization at the top of its ladder is offered nothing" */
    it("names nothing", async () => {
      const step = await service.resolve({
        plan: planOf({ type: "ACCELERATE" }),
        pricingModel: "TIERED",
      });

      expect(step).toEqual({ kind: "none" });
    });
  });

  describe("when it is on the annual variant of a rung", () => {
    /** @scenario "An annual variant is the same rung as its monthly plan" */
    it("treats it as that rung rather than as an unknown plan", async () => {
      const step = await service.resolve({
        plan: planOf({ type: "LAUNCH_ANNUAL" }),
        pricingModel: "TIERED",
      });

      expect(step).toMatchObject({ kind: "self_serve", tier: "ACCELERATE" });
    });
  });

  describe("when it is quoted in euro", () => {
    /** @scenario "A plan is quoted in the organization's own currency" */
    it("gives the euro price", async () => {
      const step = await service.resolve({
        plan: planOf({ type: "FREE", planSource: "free" }),
        pricingModel: "TIERED",
        currency: "EUR",
      });

      expect(step).toMatchObject({ monthlyPrice: 59, currency: "EUR" });
    });
  });
});

describe("given an organization on the seat and event pricing", () => {
  describe("when it sits below the seat plan", () => {
    /** @scenario "A seat-and-event organization is offered the seat plan per person" */
    it("names the seat plan and says the price is per person", async () => {
      const step = await service.resolve({
        plan: planOf({ type: "FREE", planSource: "free", free: true }),
        pricingModel: "SEAT_EVENT",
      });

      expect(step).toMatchObject({
        kind: "self_serve",
        tier: "GROWTH_SEAT",
        monthlyPrice: 32,
        pricedPerSeat: true,
      });
    });
  });

  describe("when it is already on the seat plan under one of its currency cuts", () => {
    /** @scenario "Every currency cut of the seat plan is the same rung" */
    it("names nothing above it", async () => {
      const step = await service.resolve({
        plan: planOf({ type: "GROWTH_SEAT_EUR_ANNUAL" }),
        pricingModel: "SEAT_EVENT",
      });

      expect(step).toEqual({ kind: "none" });
    });
  });
});

describe("given an organization on enterprise terms", () => {
  describe("when it is on the legacy tiered enterprise plan", () => {
    /** @scenario "A legacy enterprise organization is never quoted a public price" */
    it("names its account team instead of a plan", async () => {
      const step = await service.resolve({
        plan: planOf({ type: "ENTERPRISE" }),
        pricingModel: "TIERED",
      });

      expect(step).toEqual({ kind: "account_team" });
    });
  });

  describe("when it is on the newer enterprise pricing", () => {
    /** @scenario "A new-pricing enterprise organization is never quoted a public price" */
    it("names its account team instead of a plan", async () => {
      const step = await service.resolve({
        plan: planOf({ type: "ENTERPRISE" }),
        pricingModel: "SEAT_EVENT",
      });

      expect(step).toEqual({ kind: "account_team" });
    });
  });
});

describe("given an organization on terms of its own", () => {
  describe("when its plan came from a licence", () => {
    /** @scenario "A licensed organization is never quoted a public price" */
    it("names its account team", async () => {
      const step = await service.resolve({
        plan: planOf({ type: "LAUNCH", planSource: "license" }),
        pricingModel: "TIERED",
      });

      expect(step).toEqual({ kind: "account_team" });
    });
  });

  describe("when its plan carries an override on its own limits", () => {
    /** @scenario "An organization with negotiated limits is never quoted a public price" */
    it("names its account team", async () => {
      const step = await service.resolve({
        plan: planOf({ type: "LAUNCH", overrideAddingLimitations: true }),
        pricingModel: "TIERED",
      });

      expect(step).toEqual({ kind: "account_team" });
    });
  });

  describe("when its plan type is on no ladder we sell", () => {
    /** @scenario "An organization on a plan nobody sells self-serve is never quoted a price" */
    it("names its account team", async () => {
      const step = await service.resolve({
        plan: planOf({ type: "PARTNER_TRIAL" }),
        pricingModel: "TIERED",
      });

      expect(step).toEqual({ kind: "account_team" });
    });
  });
});

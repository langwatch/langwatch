import { describe, expect, it } from "vitest";
import { PLAN_LIMITS } from "../plan-limits.ts";
import { PlanTypes } from "../plan-types.ts";

/**
 * `PLAN_LIMITS` used to state these numbers itself. It reads them off the
 * catalogue now, so this pins every one of them at the value it had when it
 * was inline: a catalogue edit that moves a ceiling has to say so here.
 */
const PRESETS = [
  {
    type: PlanTypes.FREE,
    planSource: "free",
    name: "Free",
    free: true,
    visibilityDays: 14,
    maxMembers: 2,
    maxMembersLite: 0,
    maxMessagesPerMonth: 50_000,
    canPublish: true,
    automationDailyDispatchCeiling: 50,
    prices: { USD: 0, EUR: 0 },
  },
  {
    type: PlanTypes.PRO,
    planSource: "subscription",
    name: "Pro",
    free: false,
    maxMembers: 5,
    maxMembersLite: 9999,
    maxMessagesPerMonth: 10_000,
    canPublish: true,
    automationDailyDispatchCeiling: 500,
    prices: { USD: 99, EUR: 99 },
  },
  {
    type: PlanTypes.LAUNCH,
    planSource: "subscription",
    name: "Launch",
    free: false,
    maxMembers: 3,
    maxMembersLite: 9999,
    maxMessagesPerMonth: 20_000,
    canPublish: true,
    automationDailyDispatchCeiling: 150,
    prices: { USD: 59, EUR: 59 },
  },
  {
    type: PlanTypes.LAUNCH_ANNUAL,
    planSource: "subscription",
    name: "Launch Annual",
    free: false,
    maxMembers: 3,
    maxMembersLite: 9999,
    maxMessagesPerMonth: 20_000,
    canPublish: true,
    automationDailyDispatchCeiling: 150,
    prices: { USD: 649, EUR: 649 },
  },
  {
    type: PlanTypes.ACCELERATE,
    planSource: "subscription",
    name: "Accelerate",
    free: false,
    maxMembers: 5,
    maxMembersLite: 9999,
    maxMessagesPerMonth: 20_000,
    canPublish: true,
    automationDailyDispatchCeiling: 300,
    prices: { USD: 199, EUR: 199 },
  },
  {
    type: PlanTypes.ACCELERATE_ANNUAL,
    planSource: "subscription",
    name: "Accelerate Annual",
    free: false,
    maxMembers: 5,
    maxMembersLite: 9999,
    maxMessagesPerMonth: 20_000,
    canPublish: true,
    automationDailyDispatchCeiling: 300,
    prices: { USD: 2199, EUR: 2199 },
  },
  {
    type: PlanTypes.GROWTH,
    planSource: "subscription",
    name: "Growth",
    free: false,
    maxMembers: 10,
    maxMembersLite: 9999,
    maxMessagesPerMonth: 100_000,
    canPublish: true,
    automationDailyDispatchCeiling: 500,
    prices: { USD: 399, EUR: 399 },
  },
  {
    type: PlanTypes.ENTERPRISE,
    planSource: "subscription",
    name: "Enterprise",
    free: false,
    maxMembers: 1000,
    maxMembersLite: 9999,
    maxMessagesPerMonth: 1_000_000,
    canPublish: true,
    automationDailyDispatchCeiling: 5_000,
    webhookEndpointsEnabled: true,
    prices: { USD: 999, EUR: 999 },
  },
] as const;

const GROWTH_SEAT_PRESET = {
  planSource: "subscription",
  name: "Growth",
  free: false,
  maxMembers: 20,
  maxMembersLite: 9999,
  maxMessagesPerMonth: 999_999_999,
  canPublish: true,
  automationDailyDispatchCeiling: 500,
  userPrice: { USD: 32, EUR: 29 },
  prices: { USD: 0, EUR: 0 },
} as const;

const GROWTH_SEAT_TYPES = [
  PlanTypes.GROWTH_SEAT_EUR_MONTHLY,
  PlanTypes.GROWTH_SEAT_EUR_ANNUAL,
  PlanTypes.GROWTH_SEAT_USD_MONTHLY,
  PlanTypes.GROWTH_SEAT_USD_ANNUAL,
] as const;

describe("PLAN_LIMITS read off the catalogue", () => {
  describe.each(PRESETS)("given $type", (preset) => {
    it("quotes the numbers it quoted when they were inline", () => {
      expect(PLAN_LIMITS[preset.type]).toEqual(preset);
    });
  });

  describe.each(GROWTH_SEAT_TYPES)("given %s", (type) => {
    it("quotes the seat-priced growth numbers", () => {
      expect(PLAN_LIMITS[type]).toEqual({ ...GROWTH_SEAT_PRESET, type });
    });
  });

  describe("when a plan states nothing about webhook endpoints", () => {
    it("leaves the key absent rather than answering no", () => {
      expect(PLAN_LIMITS[PlanTypes.FREE]).not.toHaveProperty("webhookEndpointsEnabled");
      expect(PLAN_LIMITS[PlanTypes.GROWTH]).not.toHaveProperty("webhookEndpointsEnabled");
    });
  });

  describe("when a plan is not priced per seat", () => {
    it("states no seat price at all", () => {
      expect(PLAN_LIMITS[PlanTypes.GROWTH]).not.toHaveProperty("userPrice");
    });
  });

  describe("when a plan carries no visibility window", () => {
    it("leaves the key absent, so only Free is redacted", () => {
      expect(PLAN_LIMITS[PlanTypes.PRO]).not.toHaveProperty("visibilityDays");
    });
  });
});

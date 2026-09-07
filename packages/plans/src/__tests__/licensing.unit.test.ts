import { describe, expect, it } from "vitest";
import {
  CLOUD_FREE_LICENSING_PLAN,
  ENTERPRISE_TEMPLATE,
  GROWTH_TEMPLATE,
  OPEN_SOURCE_LICENSING_PLAN,
  PRO_TEMPLATE,
} from "../licensing.ts";

/**
 * These plans were stated inside the licensing feature until they moved here.
 * Every number is pinned at the value it had there: a self-hosted contract is
 * enforced against them, and the drift with billing's Free tier is unresolved.
 */
describe("the plans a licence resolves to", () => {
  describe("given no licence on a self-hosted deployment", () => {
    it("caps nothing the deployment keeps on its own infrastructure", () => {
      expect(OPEN_SOURCE_LICENSING_PLAN).toEqual({
        planSource: "free",
        type: "OPEN_SOURCE",
        name: "Open Source",
        free: true,
        overrideAddingLimitations: true,
        maxMembers: Number.MAX_SAFE_INTEGER,
        maxMembersLite: Number.MAX_SAFE_INTEGER,
        maxMessagesPerMonth: Number.MAX_SAFE_INTEGER,
        canPublish: true,
        usageUnit: "traces",
        prices: { USD: 0, EUR: 0 },
      });
    });
  });

  describe("given the cloud free tier as licensing states it", () => {
    it("sells one seat, a thousand messages and no publishing", () => {
      expect(CLOUD_FREE_LICENSING_PLAN).toEqual({
        planSource: "free",
        type: "FREE",
        name: "Free",
        free: true,
        overrideAddingLimitations: false,
        maxMembers: 1,
        maxMembersLite: 0,
        maxMessagesPerMonth: 1_000,
        canPublish: false,
        usageUnit: "traces",
        prices: { USD: 0, EUR: 0 },
      });
    });

    it("states no visibility window, which the caller adds", () => {
      expect(CLOUD_FREE_LICENSING_PLAN).not.toHaveProperty("visibilityDays");
    });
  });
});

describe("the templates a key is minted from", () => {
  it("mints Growth uncapped, with the seat count supplied at generation", () => {
    expect(GROWTH_TEMPLATE).toEqual({
      type: "GROWTH",
      name: "Growth",
      maxMembersLite: Number.MAX_SAFE_INTEGER,
      maxMessagesPerMonth: Number.MAX_SAFE_INTEGER,
      canPublish: true,
      usageUnit: "events",
    });
  });

  it("mints Pro at ten seats and a hundred thousand traces", () => {
    expect(PRO_TEMPLATE).toEqual({
      type: "PRO",
      name: "Pro",
      maxMembers: 10,
      maxMembersLite: 5,
      maxMessagesPerMonth: 100000,
      canPublish: true,
      usageUnit: "traces",
    });
  });

  it("mints Enterprise with the webhook endpoints it sells", () => {
    expect(ENTERPRISE_TEMPLATE).toEqual({
      type: "ENTERPRISE",
      name: "Enterprise",
      maxMembers: 100,
      maxMembersLite: 50,
      maxMessagesPerMonth: 10000000,
      canPublish: true,
      webhookEndpointsEnabled: true,
      usageUnit: "traces",
    });
  });
});

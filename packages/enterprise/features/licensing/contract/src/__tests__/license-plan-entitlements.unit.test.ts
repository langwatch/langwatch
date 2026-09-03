import { describe, expect, it } from "vitest";
import { UNLIMITED_PLAN } from "../index";
import { applyPlanTypeEntitlements, ENTITLEMENTS_BY_PLAN_TYPE } from "../index";
import type { PlanInfo } from "../index";

/**
 * Spec: specs/licensing/plan-entitlements.feature
 *
 * The identity-preserving return is not a micro-optimization: callers
 * downstream assert on object identity, so a plan with nothing to fill has to
 * come back as itself.
 */

const enterprisePlan = (overrides: Partial<PlanInfo> = {}): PlanInfo => ({
  planSource: "license",
  type: "ENTERPRISE",
  name: "Enterprise",
  free: false,
  maxMembers: 100,
  maxMembersLite: 50,
  maxMessagesPerMonth: 10_000_000,
  canPublish: true,
  prices: { USD: 0, EUR: 0 },
  ...overrides,
});

describe("applyPlanTypeEntitlements", () => {
  describe("given an enterprise plan that says nothing about webhook endpoints", () => {
    /** @scenario An enterprise license signed before the flag existed is entitled */
    it("entitles it from its tier", () => {
      const resolved = applyPlanTypeEntitlements(enterprisePlan());

      expect(resolved.webhookEndpointsEnabled).toBe(true);
    });

    it("leaves everything else on the plan alone", () => {
      const plan = enterprisePlan({ maxMembers: 7 });

      const resolved = applyPlanTypeEntitlements(plan);

      expect({ ...resolved, webhookEndpointsEnabled: undefined }).toEqual({
        ...plan,
        webhookEndpointsEnabled: undefined,
      });
    });
  });

  describe("given an enterprise plan that switches webhook endpoints off", () => {
    /** @scenario An entitlement switched off in the payload stays off */
    it("keeps it off, because an explicit answer is a decision", () => {
      const resolved = applyPlanTypeEntitlements(
        enterprisePlan({ webhookEndpointsEnabled: false }),
      );

      expect(resolved.webhookEndpointsEnabled).toBe(false);
    });
  });

  describe("given a plan on a tier the map says nothing about", () => {
    /** @scenario A plan below enterprise is not entitled */
    it("adds no entitlement to it", () => {
      const resolved = applyPlanTypeEntitlements(
        enterprisePlan({ type: "GROWTH", name: "Growth" }),
      );

      expect(resolved.webhookEndpointsEnabled).toBeUndefined();
    });

    /** @scenario The unlicensed open-source baseline gains nothing from the tier map */
    it("hands back the open-source baseline untouched", () => {
      const resolved = applyPlanTypeEntitlements(UNLIMITED_PLAN);

      expect(resolved).toBe(UNLIMITED_PLAN);
    });
  });

  describe("given a plan with nothing left to fill", () => {
    /** @scenario A plan that needs nothing filled in is handed back untouched */
    it("returns the very same object", () => {
      const plan = enterprisePlan({ webhookEndpointsEnabled: true });

      expect(applyPlanTypeEntitlements(plan)).toBe(plan);
    });
  });

  describe("given the tier map itself", () => {
    /** @scenario Impersonation powers are not an entitlement of the enterprise tier */
    it("does not carry authorization fields for any tier", () => {
      for (const entitlements of Object.values(ENTITLEMENTS_BY_PLAN_TYPE)) {
        expect("overrideAddingLimitations" in (entitlements ?? {})).toBe(false);
      }
    });

    it("entitles webhook endpoints on enterprise and on nothing else", () => {
      expect(Object.keys(ENTITLEMENTS_BY_PLAN_TYPE)).toEqual(["ENTERPRISE"]);
      expect(ENTITLEMENTS_BY_PLAN_TYPE["ENTERPRISE"]?.webhookEndpointsEnabled).toBe(true);
    });
  });
});

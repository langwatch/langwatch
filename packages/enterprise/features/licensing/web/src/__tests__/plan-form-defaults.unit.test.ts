import { describe, expect, it } from "vitest";
import {
  ENTERPRISE_TEMPLATE,
  PRO_TEMPLATE,
} from "@langwatch/enterprise-licensing-contract";
import { getPlanDefaults, PLAN_DEFAULTS, type PlanType } from "../plan-form-defaults";

/**
 * Spec: specs/licensing/license-generation.feature
 *
 * These defaults are both what the generator form shows and what it sends, so
 * a field missing here is a field silently missing from every license minted
 * through the product.
 */

describe("planFormDefaults", () => {
  describe("getPlanDefaults", () => {
    it("returns PRO template defaults for PRO plan", () => {
      const defaults = getPlanDefaults("PRO");

      expect(defaults).toEqual({
        maxMembers: PRO_TEMPLATE.maxMembers,
        maxMembersLite: PRO_TEMPLATE.maxMembersLite,
        maxMessagesPerMonth: PRO_TEMPLATE.maxMessagesPerMonth,
        canPublish: PRO_TEMPLATE.canPublish,
        webhookEndpointsEnabled: PRO_TEMPLATE.webhookEndpointsEnabled,
        usageUnit: PRO_TEMPLATE.usageUnit,
      });
    });

    it("returns ENTERPRISE template defaults for ENTERPRISE plan", () => {
      const defaults = getPlanDefaults("ENTERPRISE");

      expect(defaults).toEqual({
        maxMembers: ENTERPRISE_TEMPLATE.maxMembers,
        maxMembersLite: ENTERPRISE_TEMPLATE.maxMembersLite,
        maxMessagesPerMonth: ENTERPRISE_TEMPLATE.maxMessagesPerMonth,
        canPublish: ENTERPRISE_TEMPLATE.canPublish,
        webhookEndpointsEnabled: ENTERPRISE_TEMPLATE.webhookEndpointsEnabled,
        usageUnit: ENTERPRISE_TEMPLATE.usageUnit,
      });
    });

    /** @scenario A custom contract carries only what it was given */
    it("returns empty object for CUSTOM plan", () => {
      const defaults = getPlanDefaults("CUSTOM");

      expect(defaults).toEqual({});
    });
  });

  describe("PLAN_DEFAULTS", () => {
    it("contains entries for all plan types", () => {
      const planTypes: PlanType[] = ["PRO", "ENTERPRISE", "CUSTOM"];

      planTypes.forEach((planType) => {
        expect(PLAN_DEFAULTS).toHaveProperty(planType);
      });
    });

    it("PRO defaults match PRO_TEMPLATE values without fallbacks", () => {
      const proDefaults = PLAN_DEFAULTS.PRO;

      expect(proDefaults.maxMembers).toBe(PRO_TEMPLATE.maxMembers);
      expect(proDefaults.maxMembersLite).toBe(PRO_TEMPLATE.maxMembersLite);
      expect(proDefaults.maxMessagesPerMonth).toBe(PRO_TEMPLATE.maxMessagesPerMonth);
    });

    it("includes usageUnit in PRO and ENTERPRISE defaults", () => {
      expect(PLAN_DEFAULTS.PRO.usageUnit).toBe("traces");
      expect(PLAN_DEFAULTS.ENTERPRISE.usageUnit).toBe("traces");
    });

    it("ENTERPRISE defaults match ENTERPRISE_TEMPLATE values without fallbacks", () => {
      const enterpriseDefaults = PLAN_DEFAULTS.ENTERPRISE;

      expect(enterpriseDefaults.maxMembers).toBe(ENTERPRISE_TEMPLATE.maxMembers);
      expect(enterpriseDefaults.maxMembersLite).toBe(ENTERPRISE_TEMPLATE.maxMembersLite);
      expect(enterpriseDefaults.maxMessagesPerMonth).toBe(
        ENTERPRISE_TEMPLATE.maxMessagesPerMonth,
      );
    });

    describe("when the operator picks a plan for the webhook entitlement", () => {
      /** @scenario The generator form mints what it shows */
      it("ticks it for ENTERPRISE and clears it on a lesser plan", () => {
        expect(PLAN_DEFAULTS.ENTERPRISE.webhookEndpointsEnabled).toBe(true);

        // Present and undefined, not absent: the form spreads these over the
        // current values, so an absent key would leave the box ticked after
        // switching down from ENTERPRISE.
        expect("webhookEndpointsEnabled" in PLAN_DEFAULTS.PRO).toBe(true);
        expect(PLAN_DEFAULTS.PRO.webhookEndpointsEnabled).toBeUndefined();
      });
    });
  });
});

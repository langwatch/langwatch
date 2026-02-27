import { describe, it, expect } from "vitest";
import { getPlanDefaults, PLAN_DEFAULTS, type PlanType } from "../planFormDefaults";
import {
  PRO_TEMPLATE,
  ENTERPRISE_TEMPLATE,
} from "../../../../ee/licensing/planTemplates";

describe("planFormDefaults", () => {
  describe("getPlanDefaults", () => {
    it("returns PRO template defaults for PRO plan", () => {
      const defaults = getPlanDefaults("PRO");

      expect(defaults).toEqual({
        maxMembers: PRO_TEMPLATE.maxMembers,
        maxMembersLite: PRO_TEMPLATE.maxMembersLite,
        maxProjects: PRO_TEMPLATE.maxProjects,
        maxMessagesPerMonth: PRO_TEMPLATE.maxMessagesPerMonth,
        evaluationsCredit: PRO_TEMPLATE.evaluationsCredit,
        maxWorkflows: PRO_TEMPLATE.maxWorkflows,
        maxPrompts: PRO_TEMPLATE.maxPrompts,
        maxEvaluators: PRO_TEMPLATE.maxEvaluators,
        maxScenarios: PRO_TEMPLATE.maxScenarios,
        maxAgents: PRO_TEMPLATE.maxAgents,
        canPublish: PRO_TEMPLATE.canPublish,
        usageUnit: PRO_TEMPLATE.usageUnit,
      });
    });

    it("returns ENTERPRISE template defaults for ENTERPRISE plan", () => {
      const defaults = getPlanDefaults("ENTERPRISE");

      expect(defaults).toEqual({
        maxMembers: ENTERPRISE_TEMPLATE.maxMembers,
        maxMembersLite: ENTERPRISE_TEMPLATE.maxMembersLite,
        maxProjects: ENTERPRISE_TEMPLATE.maxProjects,
        maxMessagesPerMonth: ENTERPRISE_TEMPLATE.maxMessagesPerMonth,
        evaluationsCredit: ENTERPRISE_TEMPLATE.evaluationsCredit,
        maxWorkflows: ENTERPRISE_TEMPLATE.maxWorkflows,
        maxPrompts: ENTERPRISE_TEMPLATE.maxPrompts,
        maxEvaluators: ENTERPRISE_TEMPLATE.maxEvaluators,
        maxScenarios: ENTERPRISE_TEMPLATE.maxScenarios,
        maxAgents: ENTERPRISE_TEMPLATE.maxAgents,
        canPublish: ENTERPRISE_TEMPLATE.canPublish,
        usageUnit: ENTERPRISE_TEMPLATE.usageUnit,
      });
    });

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

      expect(proDefaults.maxPrompts).toBe(PRO_TEMPLATE.maxPrompts);
      expect(proDefaults.maxEvaluators).toBe(PRO_TEMPLATE.maxEvaluators);
      expect(proDefaults.maxScenarios).toBe(PRO_TEMPLATE.maxScenarios);
      expect(proDefaults.maxAgents).toBe(PRO_TEMPLATE.maxAgents);
    });

    it("includes usageUnit in PRO and ENTERPRISE defaults", () => {
      expect(PLAN_DEFAULTS.PRO.usageUnit).toBe("traces");
      expect(PLAN_DEFAULTS.ENTERPRISE.usageUnit).toBe("traces");
    });

    it("ENTERPRISE defaults match ENTERPRISE_TEMPLATE values without fallbacks", () => {
      const enterpriseDefaults = PLAN_DEFAULTS.ENTERPRISE;

      expect(enterpriseDefaults.maxPrompts).toBe(ENTERPRISE_TEMPLATE.maxPrompts);
      expect(enterpriseDefaults.maxEvaluators).toBe(ENTERPRISE_TEMPLATE.maxEvaluators);
      expect(enterpriseDefaults.maxScenarios).toBe(ENTERPRISE_TEMPLATE.maxScenarios);
      expect(enterpriseDefaults.maxAgents).toBe(ENTERPRISE_TEMPLATE.maxAgents);
    });
  });
});

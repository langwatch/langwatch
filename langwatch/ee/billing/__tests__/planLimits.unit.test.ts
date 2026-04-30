import { describe, expect, it } from "vitest";
import { PLAN_LIMITS } from "../planLimits";
import { PlanTypes } from "../planTypes";
import type { PlanInfo } from "../../licensing/planInfo";
import { mapToPlanInfo } from "../../licensing/planMapping";
import { DEFAULT_LIMIT } from "../../licensing/constants";
import type { LicenseData } from "../../licensing/types";

/**
 * All required numeric limit fields on PlanInfo.
 * Used to verify both SaaS and license plans populate every field.
 */
const NUMERIC_LIMIT_FIELDS = [
  "maxMembers",
  "maxMembersLite",
  "maxTeams",
  "maxProjects",
  "maxMessagesPerMonth",
  "maxWorkflows",
  "maxPrompts",
  "maxEvaluators",
  "maxScenarios",
  "maxAgents",
  "maxExperiments",
  "maxOnlineEvaluations",
  "maxDatasets",
  "maxDashboards",
  "maxCustomGraphs",
  "maxAutomations",
] as const satisfies readonly (keyof PlanInfo)[];

describe("PLAN_LIMITS", () => {
  describe("when checking critical plan-specific fields", () => {
    it("sets PRO maxProjects to 9999", () => {
      expect(PLAN_LIMITS[PlanTypes.PRO].maxProjects).toBe(9999);
    });

    it("sets ENTERPRISE maxProjects to 9999", () => {
      expect(PLAN_LIMITS[PlanTypes.ENTERPRISE].maxProjects).toBe(9999);
    });

    it("sets FREE maxProjects to 2", () => {
      expect(PLAN_LIMITS[PlanTypes.FREE].maxProjects).toBe(2);
    });
  });

  describe("field completeness parity", () => {
    const planEntries = Object.entries(PLAN_LIMITS) as [string, PlanInfo][];

    describe("when checking SaaS plans for numeric limit completeness", () => {
      /** @scenario SaaS-sourced plan populates all limit fields */
      it.each(planEntries)(
        "populates all 16 numeric limit fields for %s",
        (_planType, plan) => {
          for (const field of NUMERIC_LIMIT_FIELDS) {
            const value = plan[field];
            expect(value, `${_planType}.${field} is undefined`).toBeDefined();
            expect(typeof value, `${_planType}.${field} is not a number`).toBe(
              "number",
            );
          }
        },
      );
    });

    describe("when checking license-sourced plan field completeness", () => {
      const minimalLicense: LicenseData = {
        licenseId: "lic-test",
        version: 1,
        organizationName: "Test Org",
        email: "test@example.com",
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(
          Date.now() + 365 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        plan: {
          type: "PRO",
          name: "Pro",
          maxMembers: 10,
          maxProjects: 99,
          maxMessagesPerMonth: 100_000,
          maxWorkflows: 50,
          canPublish: true,
        },
      };

      /** @scenario License-sourced plan populates all limit fields */
      it("populates all 16 numeric limit fields via defaults", () => {
        const plan = mapToPlanInfo(minimalLicense);

        for (const field of NUMERIC_LIMIT_FIELDS) {
          const value = plan[field];
          expect(value, `license.${field} is undefined`).toBeDefined();
          expect(typeof value, `license.${field} is not a number`).toBe(
            "number",
          );
        }
      });

      it("defaults usageUnit to traces for legacy licenses", () => {
        const plan = mapToPlanInfo(minimalLicense);
        expect(plan.usageUnit).toBe("traces");
      });

      it("defaults missing optional fields to DEFAULT_LIMIT", () => {
        const plan = mapToPlanInfo(minimalLicense);

        expect(plan.maxPrompts).toBe(DEFAULT_LIMIT);
        expect(plan.maxEvaluators).toBe(DEFAULT_LIMIT);
        expect(plan.maxScenarios).toBe(DEFAULT_LIMIT);
        expect(plan.maxAgents).toBe(DEFAULT_LIMIT);
        expect(plan.maxExperiments).toBe(DEFAULT_LIMIT);
        expect(plan.maxOnlineEvaluations).toBe(DEFAULT_LIMIT);
        expect(plan.maxDatasets).toBe(DEFAULT_LIMIT);
        expect(plan.maxDashboards).toBe(DEFAULT_LIMIT);
        expect(plan.maxCustomGraphs).toBe(DEFAULT_LIMIT);
        expect(plan.maxAutomations).toBe(DEFAULT_LIMIT);
      });
    });
  });
});

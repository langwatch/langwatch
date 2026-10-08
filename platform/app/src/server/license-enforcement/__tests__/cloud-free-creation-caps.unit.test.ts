import { describe, expect, it, vi } from "vitest";
import {
  FREE_PLAN_CREATION_CAPS,
  PLAN_LIMITS,
} from "../../../../ee/billing/planLimits";
import { PlanTypes } from "../../../../ee/billing/planTypes";
import { UNLIMITED_PLAN } from "../../../../ee/licensing/constants";
import type { PlanInfo } from "../../../../ee/licensing/planInfo";
import { mapToPlanInfo } from "../../../../ee/licensing/planMapping";
import type { LicenseData } from "../../../../ee/licensing/types";
import { LimitExceededError } from "../errors";
import type { ILicenseEnforcementRepository } from "../license-enforcement.repository";
import {
  LicenseEnforcementService,
  UNCAPPED_LIMIT,
} from "../license-enforcement.service";
import type { LimitType } from "../types";

const ORG_ID = "org-acme";

const cloudFree = PLAN_LIMITS[PlanTypes.FREE];
const cloudPaid = PLAN_LIMITS[PlanTypes.LAUNCH];

function buildService({
  plan,
  scenarios = 0,
  evaluators = 0,
  scenarioSets = 0,
}: {
  plan: PlanInfo;
  scenarios?: number;
  evaluators?: number;
  scenarioSets?: number;
}) {
  const repository: ILicenseEnforcementRepository = {
    getMemberCount: vi.fn().mockResolvedValue(0),
    getMembersLiteCount: vi.fn().mockResolvedValue(0),
    getMembersDeveloperCount: vi.fn().mockResolvedValue(0),
    getActiveScenarioCount: vi.fn().mockResolvedValue(scenarios),
    getEvaluatorCount: vi.fn().mockResolvedValue(evaluators),
    getCurrentMonthCost: vi.fn().mockResolvedValue(0),
    getCurrentMonthCostForProjects: vi.fn().mockResolvedValue(0),
  };
  const countScenarioSets = vi.fn().mockResolvedValue(scenarioSets);
  const service = new LicenseEnforcementService(
    repository,
    { getActivePlan: vi.fn().mockResolvedValue(plan) },
    countScenarioSets,
  );
  return { service, repository, countScenarioSets };
}

async function refusal(
  promise: Promise<unknown>,
): Promise<LimitExceededError | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    if (error instanceof LimitExceededError) return error;
    throw error;
  }
}

describe("cloud Free creation caps", () => {
  describe("given the organization is on the cloud Free plan", () => {
    it("caps scenarios, simulations and custom evaluators at 3", () => {
      expect(cloudFree).toMatchObject({
        maxScenarios: 3,
        maxScenarioSets: 3,
        maxEvaluators: 3,
      });
    });

    describe("when it already has 3 active scenarios", () => {
      /** @scenario Cloud Free refuses a fourth scenario */
      it("refuses another scenario with the limit shape", async () => {
        const { service } = buildService({ plan: cloudFree, scenarios: 3 });

        const error = await refusal(service.enforceLimit(ORG_ID, "scenarios"));

        expect(error?.code).toBe("resource_limit_exceeded");
        expect(error?.meta).toEqual({
          limitType: "scenarios",
          current: 3,
          max: 3,
        });
      });
    });

    describe("when it already has 3 active custom evaluators", () => {
      /** @scenario Cloud Free refuses a fourth custom evaluator */
      it("refuses another custom evaluator with the limit shape", async () => {
        const { service } = buildService({ plan: cloudFree, evaluators: 3 });

        const error = await refusal(service.enforceLimit(ORG_ID, "evaluators"));

        expect(error?.code).toBe("resource_limit_exceeded");
        expect(error?.meta).toEqual({
          limitType: "evaluators",
          current: 3,
          max: 3,
        });
      });
    });

    describe("when it has 2 active scenarios", () => {
      /** @scenario Cloud Free allows creating below the cap */
      it("allows another scenario", async () => {
        const { service } = buildService({ plan: cloudFree, scenarios: 2 });

        await expect(
          service.enforceLimit(ORG_ID, "scenarios"),
        ).resolves.toBeUndefined();
      });
    });

    describe("when it has run 3 distinct scenario sets", () => {
      it("reports the simulation cap as reached", async () => {
        const { service } = buildService({ plan: cloudFree, scenarioSets: 3 });

        const result = await service.checkLimit(ORG_ID, "scenarioSets");

        expect(result).toEqual({
          allowed: false,
          current: 3,
          max: 3,
          limitType: "scenarioSets",
        });
      });
    });

    describe("when an admin impersonates a member", () => {
      it("does not refuse", async () => {
        const { service } = buildService({
          plan: { ...cloudFree, overrideAddingLimitations: true },
          scenarios: 10,
        });

        await expect(
          service.enforceLimit(ORG_ID, "scenarios"),
        ).resolves.toBeUndefined();
      });
    });
  });

  describe("given the organization is on a paid cloud plan", () => {
    const capped: LimitType[] = ["scenarios", "scenarioSets", "evaluators"];

    /** @scenario Paid cloud plans are not capped */
    it.each(capped)("allows another %s without counting", async (limitType) => {
      const { service, repository, countScenarioSets } = buildService({
        plan: cloudPaid,
        scenarios: 50,
        evaluators: 50,
        scenarioSets: 50,
      });

      const result = await service.checkLimit(ORG_ID, limitType);

      expect(result).toMatchObject({ allowed: true, max: UNCAPPED_LIMIT });
      expect(repository.getActiveScenarioCount).not.toHaveBeenCalled();
      expect(repository.getEvaluatorCount).not.toHaveBeenCalled();
      expect(countScenarioSets).not.toHaveBeenCalled();
    });

    it("sets no creation cap on any paid plan", () => {
      for (const [type, plan] of Object.entries(PLAN_LIMITS)) {
        if (type === PlanTypes.FREE) continue;
        expect(plan.maxScenarios).toBeUndefined();
        expect(plan.maxScenarioSets).toBeUndefined();
        expect(plan.maxEvaluators).toBeUndefined();
      }
    });
  });

  describe("given a self-hosted deployment", () => {
    describe("when it has no license", () => {
      /** @scenario Self-hosted without a license is not capped */
      it("resolves a plan with no creation caps", async () => {
        expect(UNLIMITED_PLAN.maxScenarios).toBeUndefined();
        expect(UNLIMITED_PLAN.maxScenarioSets).toBeUndefined();
        expect(UNLIMITED_PLAN.maxEvaluators).toBeUndefined();

        const { service } = buildService({
          plan: UNLIMITED_PLAN,
          scenarios: 100,
        });
        await expect(
          service.enforceLimit(ORG_ID, "scenarios"),
        ).resolves.toBeUndefined();
      });
    });

    describe("when its license payload still carries maxScenarios", () => {
      /** @scenario Self-hosted with a license is not capped */
      it("does not carry the caps into the active plan", async () => {
        const license: LicenseData = {
          licenseId: "lic-acme",
          version: 1,
          organizationName: "ACME",
          email: "admin@acme.test",
          issuedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          plan: {
            type: "ENTERPRISE",
            name: "Enterprise",
            maxMembers: 10,
            maxMessagesPerMonth: 100_000,
            canPublish: true,
            maxScenarios: 3,
            maxEvaluators: 3,
          },
        };

        const plan = mapToPlanInfo(license);

        expect(plan.maxScenarios).toBeUndefined();
        expect(plan.maxScenarioSets).toBeUndefined();
        expect(plan.maxEvaluators).toBeUndefined();

        const { service } = buildService({ plan, evaluators: 100 });
        await expect(
          service.enforceLimit(ORG_ID, "evaluators"),
        ).resolves.toBeUndefined();
      });
    });
  });

  it("keeps the cloud Free caps in one place", () => {
    expect(FREE_PLAN_CREATION_CAPS).toEqual({
      maxScenarios: 3,
      maxScenarioSets: 3,
      maxEvaluators: 3,
    });
  });
});

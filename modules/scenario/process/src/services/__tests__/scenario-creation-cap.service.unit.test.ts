import { LimitExceededError } from "@langwatch/enterprise-licensing-contract";
import type { Plan } from "@langwatch/entitlement-contract";
import { ScenarioEventType } from "@langwatch/scenario-contract";
import { describe, expect, it, vi } from "vitest";

import { ScenarioCreationCapService } from "../scenario-creation-cap.service.ts";

/** The cloud Free caps (specs/licensing/cloud-free-creation-caps.feature). */
const CLOUD_FREE = {
  maxScenarios: 3,
  maxEvaluators: 3,
  maxScenarioRunsPerMonth: 100,
  scenarioRunGraceDays: 14,
};

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    planSource: "free",
    type: "FREE",
    name: "Free",
    free: true,
    maxMembers: 2,
    maxMembersLite: 0,
    maxMessagesPerMonth: 50_000,
    canPublish: true,
    prices: { USD: 0, EUR: 0 },
    ...overrides,
  };
}

function capsWith({
  activePlan = plan(CLOUD_FREE),
  scenarios = 0,
  runCap = async () => undefined,
}: {
  activePlan?: Plan;
  scenarios?: number;
  runCap?: () => Promise<void>;
} = {}) {
  const countActiveByProjects = vi.fn(async () => scenarios);
  const assertScenarioRunAllowed = vi.fn(runCap);
  const service = ScenarioCreationCapService.create({
    plans: { getActivePlan: async () => activePlan, assertScenarioRunAllowed },
    projects: {
      getOrganizationId: async () => "organization-1",
      listIdsByOrganization: async () => ["project-1", "project-2"],
    },
    scenarios: { countActiveByProjects },
  });
  return { service, countActiveByProjects, assertScenarioRunAllowed };
}

function runStarted(scenarioSetId: string) {
  return { projectId: "project-1", event: { type: ScenarioEventType.RUN_STARTED, scenarioSetId } };
}

describe("ScenarioCreationCapService", () => {
  describe("given the organization is on the cloud Free plan", () => {
    describe("when it already has 3 active scenarios", () => {
      /** @scenario Cloud Free refuses a fourth scenario */
      it("refuses another scenario with the limit shape", async () => {
        const { service } = capsWith({ scenarios: 3 });

        await expect(
          service.assertScenarioCreationAllowed({ projectId: "project-1" }),
        ).rejects.toMatchObject({
          code: "resource_limit_exceeded",
          httpStatus: 403,
          meta: { limitType: "scenarios", current: 3, max: 3 },
        });
      });
    });

    describe("when it has 2 active scenarios", () => {
      /** @scenario Cloud Free allows creating below the cap */
      it("allows another scenario", async () => {
        const { service } = capsWith({ scenarios: 2 });

        await expect(
          service.assertScenarioCreationAllowed({ projectId: "project-1" }),
        ).resolves.toBeUndefined();
      });
    });

    describe("when a run starts", () => {
      it("asks the entitlement run cap for the project's organization", async () => {
        const { service, assertScenarioRunAllowed } = capsWith();

        await service.assertRunStartAllowed(runStarted("d"));

        expect(assertScenarioRunAllowed).toHaveBeenCalledWith({ organizationId: "organization-1" });
      });

      /** @scenario A run reported through the SDK past the run cap is refused with the limit shape */
      it("passes the run cap's refusal through", async () => {
        const { service } = capsWith({
          runCap: async () => {
            throw new LimitExceededError("scenarioRuns", 100, 100);
          },
        });

        await expect(service.assertRunStartAllowed(runStarted("d"))).rejects.toMatchObject({
          meta: { limitType: "scenarioRuns", current: 100, max: 100 },
        });
      });

      it("ignores events other than a run start", async () => {
        const { service, assertScenarioRunAllowed } = capsWith();

        await service.assertRunStartAllowed({
          projectId: "project-1",
          event: { type: ScenarioEventType.MESSAGE_SNAPSHOT, scenarioSetId: "d" },
        });

        expect(assertScenarioRunAllowed).not.toHaveBeenCalled();
      });
    });

    describe("when a platform-owned set starts a run", () => {
      it("does not ask the run cap", async () => {
        const { service, assertScenarioRunAllowed } = capsWith();

        await service.assertRunStartAllowed(runStarted("voice-calls"));
        await service.assertRunStartAllowed(runStarted("my-agent__agent-test"));

        expect(assertScenarioRunAllowed).not.toHaveBeenCalled();
      });
    });

    describe("when an operator lifts the plan's limitations", () => {
      it("does not refuse", async () => {
        const { service, countActiveByProjects } = capsWith({
          activePlan: plan({ ...CLOUD_FREE, overrideAddingLimitations: true }),
          scenarios: 10,
        });

        await service.assertScenarioCreationAllowed({ projectId: "project-1", operatorId: "u" });

        expect(countActiveByProjects).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a paid cloud plan", () => {
    /** @scenario Paid cloud plans are not capped */
    it("neither counts nor refuses scenarios", async () => {
      const { service, countActiveByProjects } = capsWith({
        activePlan: plan({ planSource: "subscription", type: "LAUNCH", free: false }),
        scenarios: 50,
      });

      await service.assertScenarioCreationAllowed({ projectId: "project-1" });

      expect(countActiveByProjects).not.toHaveBeenCalled();
    });
  });
});

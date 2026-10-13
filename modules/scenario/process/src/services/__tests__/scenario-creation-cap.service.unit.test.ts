import type { Plan } from "@langwatch/entitlement-contract";
import { ScenarioEventType } from "@langwatch/scenario-contract";
import { describe, expect, it, vi } from "vitest";

import { ScenarioCreationCapService } from "../scenario-creation-cap.service.ts";

/** The cloud Free caps (specs/licensing/cloud-free-creation-caps.feature). */
const CLOUD_FREE = { maxScenarios: 3, maxScenarioSets: 3, maxEvaluators: 3 };

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
  setIds = [] as string[],
  setRead,
}: {
  activePlan?: Plan;
  scenarios?: number;
  setIds?: string[];
  setRead?: () => Promise<Set<string>>;
} = {}) {
  const countActiveByProjects = vi.fn(async () => scenarios);
  const getDistinctExternalSetIds = vi.fn(setRead ?? (async () => new Set(setIds)));
  const service = ScenarioCreationCapService.create({
    plans: { getActivePlan: async () => activePlan },
    projects: {
      getOrganizationId: async () => "organization-1",
      listIdsByOrganization: async () => ["project-1", "project-2"],
    },
    scenarios: { countActiveByProjects },
    simulations: { getDistinctExternalSetIds },
  });
  return { service, countActiveByProjects, getDistinctExternalSetIds };
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

    describe("when it has run 3 distinct simulations", () => {
      /** @scenario Cloud Free refuses a run that starts a fourth new simulation */
      it("refuses a run that starts a new one", async () => {
        const { service } = capsWith({ setIds: ["a", "b", "c"] });

        await expect(service.assertRunStartAllowed(runStarted("d"))).rejects.toMatchObject({
          meta: { limitType: "scenarioSets", current: 3, max: 3 },
        });
      });

      /** @scenario A simulation the organization already ran keeps running over the cap */
      it("keeps running a simulation it already ran", async () => {
        const { service } = capsWith({ setIds: ["a", "b", "c", "d"] });

        await expect(service.assertRunStartAllowed(runStarted("b"))).resolves.toBeUndefined();
      });

      it("ignores events other than a run start", async () => {
        const { service, getDistinctExternalSetIds } = capsWith({ setIds: ["a", "b", "c"] });

        await service.assertRunStartAllowed({
          projectId: "project-1",
          event: { type: ScenarioEventType.MESSAGE_SNAPSHOT, scenarioSetId: "d" },
        });

        expect(getDistinctExternalSetIds).not.toHaveBeenCalled();
      });
    });

    describe("when two new simulations start before the count catches up", () => {
      it("remembers the first, so the second past the cap is refused", async () => {
        const { service } = capsWith({ setIds: ["a", "b"] });

        await service.assertRunStartAllowed(runStarted("c"));

        await expect(service.assertRunStartAllowed(runStarted("d"))).rejects.toMatchObject({
          meta: { limitType: "scenarioSets", current: 3, max: 3 },
        });
      });
    });

    describe("when the simulation count cannot be read", () => {
      /** @scenario An unknown simulation count does not block runs */
      it("lets the run through", async () => {
        const { service } = capsWith({
          setRead: async () => {
            throw new Error("clickhouse unavailable");
          },
        });

        await expect(service.assertRunStartAllowed(runStarted("d"))).resolves.toBeUndefined();
      });
    });

    describe("when a platform-owned set starts a run", () => {
      /** @scenario Platform-owned runs do not count as simulations */
      it("does not count it", async () => {
        const { service, getDistinctExternalSetIds } = capsWith({ setIds: ["a", "b", "c"] });

        await service.assertRunStartAllowed(runStarted("voice-calls"));
        await service.assertRunStartAllowed(runStarted("my-agent__agent-test"));

        expect(getDistinctExternalSetIds).not.toHaveBeenCalled();
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
    it("neither counts nor refuses scenarios or simulations", async () => {
      const { service, countActiveByProjects, getDistinctExternalSetIds } = capsWith({
        activePlan: plan({ planSource: "subscription", type: "LAUNCH", free: false }),
        scenarios: 50,
        setIds: Array.from({ length: 50 }, (_, index) => `set-${index}`),
      });

      await service.assertScenarioCreationAllowed({ projectId: "project-1" });
      await service.assertRunStartAllowed(runStarted("new-set"));

      expect(countActiveByProjects).not.toHaveBeenCalled();
      expect(getDistinctExternalSetIds).not.toHaveBeenCalled();
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { PLAN_LIMITS } from "../../../../../ee/billing/planLimits";
import { PlanTypes } from "../../../../../ee/billing/planTypes";
import { UNLIMITED_PLAN } from "../../../../../ee/licensing/constants";
import type { PlanInfo } from "../../../../../ee/licensing/planInfo";
import { LimitExceededError } from "../../../license-enforcement/errors";
import type { EventUsageService } from "../../../traces/event-usage.service";
import type { TraceUsageService } from "../../../traces/trace-usage.service";
import type { OrganizationService } from "../../organizations/organization.service";
import { UsageService } from "../usage.service";

vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({ redis: null }),
  tryGetApp: () => null,
}));

const ORG_ID = "org-acme";

function buildService({
  plan,
  knownSets,
}: {
  plan: PlanInfo;
  knownSets: string[];
}) {
  const organizationService = {
    getProjectIds: vi.fn().mockResolvedValue(["project-1", "project-2"]),
  } as unknown as OrganizationService;
  const simulations = {
    getDistinctExternalSetIds: vi.fn().mockResolvedValue(new Set(knownSets)),
  };
  const service = new UsageService(
    organizationService,
    {} as TraceUsageService,
    {} as EventUsageService,
    async () => plan,
    null,
    simulations,
  );
  return { service, simulations };
}

const cloudFree = PLAN_LIMITS[PlanTypes.FREE];

describe("UsageService.checkScenarioSetLimit", () => {
  let organizationId: string;
  let sequence = 0;

  beforeEach(() => {
    // The scenario set cache is in memory per instance; a fresh org id per
    // test keeps the cases independent of each other anyway.
    sequence += 1;
    organizationId = `${ORG_ID}-${sequence}`;
  });

  describe("given the organization is on the cloud Free plan", () => {
    describe("when it has run 3 distinct scenario sets", () => {
      /** @scenario Cloud Free refuses a run that starts a fourth new simulation */
      it("refuses a run for a new set with the limit shape", async () => {
        const { service } = buildService({
          plan: cloudFree,
          knownSets: ["set-a", "set-b", "set-c"],
        });

        const error = await service
          .checkScenarioSetLimit({ organizationId, scenarioSetId: "set-d" })
          .then(() => undefined)
          .catch((e: unknown) => e);

        expect(error).toBeInstanceOf(LimitExceededError);
        expect((error as LimitExceededError).meta).toEqual({
          limitType: "scenarioSets",
          current: 3,
          max: 3,
        });
      });
    });

    describe("when it has run 5 distinct scenario sets", () => {
      /** @scenario A simulation the organization already ran keeps running over the cap */
      it("accepts a run for a set it already ran", async () => {
        const { service } = buildService({
          plan: cloudFree,
          knownSets: ["set-a", "set-b", "set-c", "set-d", "set-e"],
        });

        await expect(
          service.checkScenarioSetLimit({
            organizationId,
            scenarioSetId: "set-e",
          }),
        ).resolves.toBeUndefined();
      });
    });

    describe("when it has run 2 sets and two new sets start back to back", () => {
      it("admits the third and refuses the fourth before ClickHouse sees either", async () => {
        const { service, simulations } = buildService({
          plan: cloudFree,
          knownSets: ["set-a", "set-b"],
        });

        await service.checkScenarioSetLimit({
          organizationId,
          scenarioSetId: "set-c",
        });
        await expect(
          service.checkScenarioSetLimit({
            organizationId,
            scenarioSetId: "set-d",
          }),
        ).rejects.toBeInstanceOf(LimitExceededError);
        expect(simulations.getDistinctExternalSetIds).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("given the organization is on the cloud Free plan and its simulation history cannot be read", () => {
    describe("when a run starts for a new set", () => {
      /** @scenario An unknown simulation count does not block runs */
      it("accepts the run", async () => {
        const { service, simulations } = buildService({
          plan: cloudFree,
          knownSets: [],
        });
        simulations.getDistinctExternalSetIds.mockRejectedValue(
          new Error("ClickHouse unavailable"),
        );

        await expect(
          service.checkScenarioSetLimit({
            organizationId,
            scenarioSetId: "set-new",
          }),
        ).resolves.toBeUndefined();
      });
    });
  });

  describe("given a plan without a simulation cap", () => {
    it.each([
      ["a paid cloud plan", PLAN_LIMITS[PlanTypes.LAUNCH]],
      ["a self-hosted deployment", UNLIMITED_PLAN],
    ])("accepts new sets on %s without counting", async (_label, plan) => {
      const { service, simulations } = buildService({
        plan,
        knownSets: Array.from({ length: 50 }, (_, i) => `set-${i}`),
      });

      await expect(
        service.checkScenarioSetLimit({
          organizationId,
          scenarioSetId: "set-new",
        }),
      ).resolves.toBeUndefined();
      expect(simulations.getDistinctExternalSetIds).not.toHaveBeenCalled();
    });
  });
});

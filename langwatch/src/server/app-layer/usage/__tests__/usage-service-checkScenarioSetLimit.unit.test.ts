import { beforeEach, describe, expect, it, vi } from "vitest";
import { TtlCache } from "~/server/utils/ttlCache";
import type { PlanResolver } from "../../subscription/plan-provider";
import type { OrganizationService } from "../../organizations/organization.service";
import { UsageService } from "../usage.service";
import { ScenarioSetLimitExceededError } from "../errors";
import { FREE_PLAN } from "../../../../../ee/licensing/constants";
import type { PlanInfo } from "../../../../../ee/licensing/planInfo";
import type { SimulationRunService } from "../../simulations/simulation-run.service";

vi.mock("../../tracing", () => ({
  traced: <T>(instance: T) => instance,
}));

vi.mock("../../../clickhouse/client", () => ({
  getClickHouseClient: () => null,
}));

const { mockEnv } = vi.hoisted(() => {
  const mockEnv: Record<string, unknown> = {};
  return { mockEnv };
});

vi.mock("~/env.mjs", () => ({
  env: new Proxy(mockEnv, {
    get: (_target, prop) => mockEnv[prop as string],
  }),
}));

const PAID_PLAN: PlanInfo = {
  ...FREE_PLAN,
  planSource: "subscription",
  type: "PRO",
  name: "Pro",
  free: false,
};

describe("UsageService.checkScenarioSetLimit", () => {
  const mockOrgService: OrganizationService = {
    getOrganizationIdByTeamId: vi.fn(),
    getProjectIds: vi.fn(),
  } as unknown as OrganizationService;

  const mockTraceUsageService = {
    getCountByProjects: vi.fn(),
  };

  const mockEventUsageService = {
    getCountByProjects: vi.fn(),
    getCurrentMonthCount: vi.fn(),
  };

  const mockOrgRepo = {
    getPricingModel: vi.fn().mockResolvedValue(null),
  };

  const mockPlanResolver = vi.fn() as unknown as PlanResolver;

  const mockGetDistinctExternalSetIds = vi.fn();
  const mockSimulationRunService: Pick<SimulationRunService, "getDistinctExternalSetIds"> = {
    getDistinctExternalSetIds: mockGetDistinctExternalSetIds,
  };

  let service: UsageService;

  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(mockEnv)) {
      delete mockEnv[key];
    }
    mockOrgRepo.getPricingModel.mockResolvedValue(null);
    (mockPlanResolver as ReturnType<typeof vi.fn>).mockResolvedValue(FREE_PLAN);
    mockGetDistinctExternalSetIds.mockResolvedValue(new Set<string>());
    service = new UsageService(
      mockOrgService,
      mockTraceUsageService as never,
      mockEventUsageService as never,
      mockPlanResolver,
      mockOrgRepo as never,
      mockSimulationRunService,
    );
  });

  describe("when organization has no existing scenario sets", () => {
    it("allows the first scenario set", async () => {
      vi.mocked(mockOrgService.getProjectIds).mockResolvedValue(["proj-1"]);
      mockGetDistinctExternalSetIds.mockResolvedValue(new Set<string>());

      await expect(
        service.checkScenarioSetLimit({
          organizationId: "org-1",
          scenarioSetId: "new-set-1",
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when organization has 2 existing scenario sets", () => {
    it("allows a third scenario set", async () => {
      vi.mocked(mockOrgService.getProjectIds).mockResolvedValue(["proj-1"]);
      mockGetDistinctExternalSetIds.mockResolvedValue(
        new Set(["set-a", "set-b"]),
      );

      await expect(
        service.checkScenarioSetLimit({
          organizationId: "org-1",
          scenarioSetId: "new-set-3",
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when organization has 3 existing scenario sets (at limit)", () => {
    beforeEach(() => {
      vi.mocked(mockOrgService.getProjectIds).mockResolvedValue(["proj-1"]);
      mockGetDistinctExternalSetIds.mockResolvedValue(
        new Set(["set-a", "set-b", "set-c"]),
      );
    });

    it("blocks a new (fourth) scenario set", async () => {
      await expect(
        service.checkScenarioSetLimit({
          organizationId: "org-1",
          scenarioSetId: "new-set-4",
        }),
      ).rejects.toThrow(ScenarioSetLimitExceededError);
    });

    it("allows an existing scenario set to be re-used", async () => {
      await expect(
        service.checkScenarioSetLimit({
          organizationId: "org-1",
          scenarioSetId: "set-a",
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when organization has 4 existing sets from before enforcement", () => {
    it("blocks a new fifth set", async () => {
      vi.mocked(mockOrgService.getProjectIds).mockResolvedValue(["proj-1"]);
      mockGetDistinctExternalSetIds.mockResolvedValue(
        new Set(["set-a", "set-b", "set-c", "set-d"]),
      );

      await expect(
        service.checkScenarioSetLimit({
          organizationId: "org-1",
          scenarioSetId: "new-set-5",
        }),
      ).rejects.toThrow(ScenarioSetLimitExceededError);
    });
  });

  describe("when on a paid plan", () => {
    it("allows unlimited scenario sets", async () => {
      (mockPlanResolver as ReturnType<typeof vi.fn>).mockResolvedValue(
        PAID_PLAN,
      );
      vi.mocked(mockOrgService.getProjectIds).mockResolvedValue(["proj-1"]);
      mockGetDistinctExternalSetIds.mockResolvedValue(
        new Set(Array.from({ length: 10 }, (_, i) => `set-${i}`)),
      );

      await expect(
        service.checkScenarioSetLimit({
          organizationId: "org-1",
          scenarioSetId: "new-set-11",
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when on a self-hosted open source plan (free with overrideAddingLimitations)", () => {
    it("allows unlimited scenario sets", async () => {
      (mockPlanResolver as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...FREE_PLAN,
        overrideAddingLimitations: true,
      });
      vi.mocked(mockOrgService.getProjectIds).mockResolvedValue(["proj-1"]);
      mockGetDistinctExternalSetIds.mockResolvedValue(
        new Set(Array.from({ length: 10 }, (_, i) => `set-${i}`)),
      );

      await expect(
        service.checkScenarioSetLimit({
          organizationId: "org-1",
          scenarioSetId: "new-set-11",
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("cache behavior", () => {
    describe("when scenario set is already in cache", () => {
      it("allows without querying the database", async () => {
        // Pre-populate cache
        const cachedSets = new Set(["my-set", "other-set"]);
        (
          service as unknown as { scenarioSetCache: TtlCache<Set<string>> }
        ).scenarioSetCache.set("org-1", cachedSets);

        await service.checkScenarioSetLimit({
          organizationId: "org-1",
          scenarioSetId: "my-set",
        });

        expect(mockGetDistinctExternalSetIds).not.toHaveBeenCalled();
        expect(mockOrgService.getProjectIds).not.toHaveBeenCalled();
      });
    });

    describe("when scenario set is not in cache", () => {
      it("queries the database and caches the result", async () => {
        vi.mocked(mockOrgService.getProjectIds).mockResolvedValue(["proj-1"]);
        mockGetDistinctExternalSetIds.mockResolvedValue(
          new Set(["existing-set"]),
        );

        await service.checkScenarioSetLimit({
          organizationId: "org-1",
          scenarioSetId: "new-set",
        });

        expect(mockGetDistinctExternalSetIds).toHaveBeenCalledTimes(1);

        // Second call for same org with now-known set should use cache
        await service.checkScenarioSetLimit({
          organizationId: "org-1",
          scenarioSetId: "new-set",
        });

        // Should NOT query again
        expect(mockGetDistinctExternalSetIds).toHaveBeenCalledTimes(1);
      });
    });

    describe("when a new set is allowed", () => {
      it("adds the new set ID to the cached set", async () => {
        vi.mocked(mockOrgService.getProjectIds).mockResolvedValue(["proj-1"]);
        mockGetDistinctExternalSetIds.mockResolvedValue(
          new Set(["existing-set"]),
        );

        await service.checkScenarioSetLimit({
          organizationId: "org-1",
          scenarioSetId: "brand-new",
        });

        // Cache should now contain both sets
        const cached = (
          service as unknown as { scenarioSetCache: TtlCache<Set<string>> }
        ).scenarioSetCache.get("org-1");
        expect(cached).toBeDefined();
        expect(cached!.has("brand-new")).toBe(true);
        expect(cached!.has("existing-set")).toBe(true);
      });
    });
  });

  describe("when organization has no projects", () => {
    it("allows the scenario set without querying", async () => {
      vi.mocked(mockOrgService.getProjectIds).mockResolvedValue([]);

      await expect(
        service.checkScenarioSetLimit({
          organizationId: "org-1",
          scenarioSetId: "new-set",
        }),
      ).resolves.toBeUndefined();

      expect(mockGetDistinctExternalSetIds).not.toHaveBeenCalled();
    });
  });

  describe("when limit is exceeded", () => {
    it("throws ScenarioSetLimitExceededError with correct details", async () => {
      vi.mocked(mockOrgService.getProjectIds).mockResolvedValue(["proj-1"]);
      mockGetDistinctExternalSetIds.mockResolvedValue(
        new Set(["set-a", "set-b", "set-c"]),
      );

      try {
        await service.checkScenarioSetLimit({
          organizationId: "org-1",
          scenarioSetId: "new-set-4",
        });
        expect.fail("Expected ScenarioSetLimitExceededError");
      } catch (error) {
        expect(error).toBeInstanceOf(ScenarioSetLimitExceededError);
        const limitError = error as ScenarioSetLimitExceededError;
        expect(limitError.meta.current).toBe(3);
        expect(limitError.meta.max).toBe(3);
        expect(limitError.httpStatus).toBe(403);
      }
    });
  });
});

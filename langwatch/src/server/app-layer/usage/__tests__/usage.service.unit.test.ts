import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TtlCache } from "~/server/utils/ttlCache";
import type { OrganizationService } from "../../organizations/organization.service";
import type { UsageRepository } from "../repositories/usage.repository";
import { UsageService } from "../usage.service";

vi.mock("~/env.mjs", () => ({
  env: { IS_SAAS: true },
}));

vi.mock("../../tracing", () => ({
  traced: <T>(instance: T) => instance,
}));

describe("UsageService", () => {
  const mockOrgService: OrganizationService = {
    getOrganizationIdByTeamId: vi.fn(),
    getProjectIds: vi.fn(),
    isFeatureEnabled: vi.fn(),
  } as unknown as OrganizationService;

  const mockRepo: UsageRepository = {
    sumBillableEvents: vi.fn(),
    groupBillableEventsByProject: vi.fn(),
  };

  const mockEsTraceUsageService = {
    getCountByProjects: vi.fn(),
  };

  const mockSubscriptionHandler = {
    getActivePlan: vi.fn(),
  };

  let service: UsageService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = Object.create(UsageService.prototype);
    Object.assign(service, {
      repo: mockRepo,
      organizationService: mockOrgService,
      esTraceUsageService: mockEsTraceUsageService,
      subscriptionHandler: mockSubscriptionHandler,
      cache: new TtlCache<number>(30_000),
    });
  });

  describe("checkLimit", () => {
    describe("when team has no organization", () => {
      it("throws OrganizationNotFoundForTeamError", async () => {
        vi.mocked(
          mockOrgService.getOrganizationIdByTeamId,
        ).mockResolvedValue(null);

        await expect(
          service.checkLimit({ teamId: "team-123" }),
        ).rejects.toThrow("Organization for team not found: team-123");
      });
    });

    describe("when count >= maxMessagesPerMonth", () => {
      beforeEach(() => {
        vi.mocked(
          mockOrgService.getOrganizationIdByTeamId,
        ).mockResolvedValue("org-123");
        vi.mocked(mockOrgService.getProjectIds).mockResolvedValue([
          "proj-1",
        ]);
        vi.mocked(mockOrgService.isFeatureEnabled).mockResolvedValue(false);
        mockEsTraceUsageService.getCountByProjects.mockResolvedValue([
          { projectId: "proj-1", count: 1000 },
        ]);
        mockSubscriptionHandler.getActivePlan.mockResolvedValue({
          name: "free",
          maxMessagesPerMonth: 1000,
        });
      });

      it("returns exceeded: true with message", async () => {
        const result = await service.checkLimit({ teamId: "team-123" });

        expect(result.exceeded).toBe(true);
        expect(result.message).toBe(
          "Monthly limit of 1000 traces reached",
        );
        expect(result.count).toBe(1000);
        expect(result.maxMessagesPerMonth).toBe(1000);
        expect(result.planName).toBe("free");
      });
    });

    describe("when count < maxMessagesPerMonth", () => {
      it("returns exceeded: false", async () => {
        vi.mocked(
          mockOrgService.getOrganizationIdByTeamId,
        ).mockResolvedValue("org-123");
        vi.mocked(mockOrgService.getProjectIds).mockResolvedValue([
          "proj-1",
        ]);
        vi.mocked(mockOrgService.isFeatureEnabled).mockResolvedValue(false);
        mockEsTraceUsageService.getCountByProjects.mockResolvedValue([
          { projectId: "proj-1", count: 500 },
        ]);
        mockSubscriptionHandler.getActivePlan.mockResolvedValue({
          maxMessagesPerMonth: 1000,
        });

        const result = await service.checkLimit({ teamId: "team-123" });

        expect(result.exceeded).toBe(false);
      });
    });

    describe("when self-hosted (IS_SAAS=false) with FREE_PLAN", () => {
      afterEach(async () => {
        const { env } = await import("~/env.mjs");
        vi.mocked(env).IS_SAAS = true;
      });

      it("returns exceeded: false regardless of count", async () => {
        const { env } = await import("~/env.mjs");
        vi.mocked(env).IS_SAAS = false;

        const { FREE_PLAN } = await import(
          "../../../../../ee/licensing/constants"
        );

        vi.mocked(
          mockOrgService.getOrganizationIdByTeamId,
        ).mockResolvedValue("org-123");
        vi.mocked(mockOrgService.getProjectIds).mockResolvedValue([
          "proj-1",
        ]);
        vi.mocked(mockOrgService.isFeatureEnabled).mockResolvedValue(false);
        mockEsTraceUsageService.getCountByProjects.mockResolvedValue([
          { projectId: "proj-1", count: 5000 },
        ]);
        mockSubscriptionHandler.getActivePlan.mockResolvedValue(FREE_PLAN);

        const result = await service.checkLimit({ teamId: "team-123" });

        expect(result.exceeded).toBe(false);
      });
    });
  });

  describe("getCurrentMonthCount", () => {
    describe("when feature is off", () => {
      it("delegates to ES TraceUsageService", async () => {
        vi.mocked(mockOrgService.getProjectIds).mockResolvedValue([
          "proj-1",
          "proj-2",
        ]);
        vi.mocked(mockOrgService.isFeatureEnabled).mockResolvedValue(false);
        mockEsTraceUsageService.getCountByProjects.mockResolvedValue([
          { projectId: "proj-1", count: 42 },
          { projectId: "proj-2", count: 58 },
        ]);

        const result = await service.getCurrentMonthCount({
          organizationId: "org-123",
        });

        expect(result).toBe(100);
        expect(
          mockEsTraceUsageService.getCountByProjects,
        ).toHaveBeenCalledWith({
          organizationId: "org-123",
          projectIds: ["proj-1", "proj-2"],
        });
        expect(mockRepo.sumBillableEvents).not.toHaveBeenCalled();
      });
    });

    describe("when feature is on", () => {
      it("sums ProjectDailyBillableEvents from month start", async () => {
        vi.mocked(mockOrgService.getProjectIds).mockResolvedValue([
          "proj-1",
          "proj-2",
        ]);
        vi.mocked(mockOrgService.isFeatureEnabled).mockResolvedValue(true);
        vi.mocked(mockRepo.sumBillableEvents).mockResolvedValue(250);

        const result = await service.getCurrentMonthCount({
          organizationId: "org-123",
        });

        expect(result).toBe(250);
        expect(mockRepo.sumBillableEvents).toHaveBeenCalledWith({
          projectIds: ["proj-1", "proj-2"],
          fromDate: expect.stringMatching(/^\d{4}-\d{2}-01$/),
        });
        expect(
          mockEsTraceUsageService.getCountByProjects,
        ).not.toHaveBeenCalled();
      });
    });

    describe("when organization has no projects", () => {
      it("returns 0 without querying any backend", async () => {
        vi.mocked(mockOrgService.getProjectIds).mockResolvedValue([]);

        const result = await service.getCurrentMonthCount({
          organizationId: "org-123",
        });

        expect(result).toBe(0);
        expect(mockOrgService.isFeatureEnabled).not.toHaveBeenCalled();
        expect(mockRepo.sumBillableEvents).not.toHaveBeenCalled();
        expect(
          mockEsTraceUsageService.getCountByProjects,
        ).not.toHaveBeenCalled();
      });
    });

    describe("when result is cached", () => {
      it("returns cached value within TTL", async () => {
        vi.mocked(mockOrgService.getProjectIds).mockResolvedValue([
          "proj-1",
        ]);
        vi.mocked(mockOrgService.isFeatureEnabled).mockResolvedValue(false);
        mockEsTraceUsageService.getCountByProjects.mockResolvedValue([
          { projectId: "proj-1", count: 42 },
        ]);

        // First call populates cache
        const first = await service.getCurrentMonthCount({
          organizationId: "org-123",
        });
        expect(first).toBe(42);

        // Second call uses cache
        const second = await service.getCurrentMonthCount({
          organizationId: "org-123",
        });
        expect(second).toBe(42);

        // Only one actual fetch
        expect(mockOrgService.getProjectIds).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("getCountByProjects", () => {
    describe("when project list is empty", () => {
      it("returns empty array", async () => {
        const result = await service.getCountByProjects({
          organizationId: "org-123",
          projectIds: [],
        });

        expect(result).toEqual([]);
        expect(mockOrgService.isFeatureEnabled).not.toHaveBeenCalled();
      });
    });

    describe("when feature is off", () => {
      it("delegates to ES TraceUsageService", async () => {
        vi.mocked(mockOrgService.isFeatureEnabled).mockResolvedValue(false);
        mockEsTraceUsageService.getCountByProjects.mockResolvedValue([
          { projectId: "proj-1", count: 10 },
          { projectId: "proj-2", count: 20 },
        ]);

        const result = await service.getCountByProjects({
          organizationId: "org-123",
          projectIds: ["proj-1", "proj-2"],
        });

        expect(result).toEqual([
          { projectId: "proj-1", count: 10 },
          { projectId: "proj-2", count: 20 },
        ]);
        expect(
          mockRepo.groupBillableEventsByProject,
        ).not.toHaveBeenCalled();
      });
    });

    describe("when feature is on", () => {
      it("groups billable events per project from Prisma", async () => {
        vi.mocked(mockOrgService.isFeatureEnabled).mockResolvedValue(true);
        vi.mocked(
          mockRepo.groupBillableEventsByProject,
        ).mockResolvedValue([
          { projectId: "proj-1", count: 15 },
          { projectId: "proj-2", count: 25 },
        ]);

        const result = await service.getCountByProjects({
          organizationId: "org-123",
          projectIds: ["proj-1", "proj-2"],
        });

        expect(result).toEqual([
          { projectId: "proj-1", count: 15 },
          { projectId: "proj-2", count: 25 },
        ]);
        expect(
          mockRepo.groupBillableEventsByProject,
        ).toHaveBeenCalledWith({
          projectIds: ["proj-1", "proj-2"],
          fromDate: expect.stringMatching(/^\d{4}-\d{2}-01$/),
        });
        expect(
          mockEsTraceUsageService.getCountByProjects,
        ).not.toHaveBeenCalled();
      });
    });
  });
});

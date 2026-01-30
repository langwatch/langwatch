import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrganizationRepository } from "~/server/repositories/organization.repository";
import {
  clearMonthCountCache,
  TraceUsageService,
} from "../trace-usage.service";
import { FREE_PLAN } from "../../../../ee/licensing/constants";

vi.mock("~/env.mjs", () => ({
  env: {
    IS_SAAS: true,
  },
}));

describe("TraceUsageService", () => {
  const mockOrganizationRepository = {
    getOrganizationIdByTeamId: vi.fn(),
    getProjectIds: vi.fn(),
  } as unknown as OrganizationRepository;

  const mockEsClient = {
    count: vi.fn(),
  };

  const mockEsClientFactory = vi.fn().mockResolvedValue(mockEsClient);

  const mockSubscriptionHandler = {
    getActivePlan: vi.fn(),
  };

  let service: TraceUsageService;

  beforeEach(() => {
    vi.clearAllMocks();
    clearMonthCountCache();
    service = new TraceUsageService(
      mockOrganizationRepository,
      mockEsClientFactory,
      mockSubscriptionHandler as any,
    );
  });

  describe("checkLimit", () => {
    describe("when organizationId is not found", () => {
      it("throws an error", async () => {
        vi.mocked(
          mockOrganizationRepository.getOrganizationIdByTeamId,
        ).mockResolvedValue(null);

        await expect(
          service.checkLimit({ teamId: "team-123" }),
        ).rejects.toThrow("Team team-123 has no organization");
      });
    });

    describe("when count >= maxMessagesPerMonth", () => {
      beforeEach(() => {
        vi.mocked(
          mockOrganizationRepository.getOrganizationIdByTeamId,
        ).mockResolvedValue("org-123");
        vi.mocked(mockOrganizationRepository.getProjectIds).mockResolvedValue([
          "proj-1",
        ]);
        mockEsClient.count.mockResolvedValue({ count: 1000 });
        mockSubscriptionHandler.getActivePlan.mockResolvedValue({
          name: "free",
          maxMessagesPerMonth: 1000,
        });
      });

      it("returns exceeded: true", async () => {
        const result = await service.checkLimit({ teamId: "team-123" });
        expect(result.exceeded).toBe(true);
      });

      it("returns message 'Monthly limit of 1000 traces reached'", async () => {
        const result = await service.checkLimit({ teamId: "team-123" });
        expect(result.message).toBe("Monthly limit of 1000 traces reached");
      });

      it("returns count and maxMessagesPerMonth as 1000", async () => {
        const result = await service.checkLimit({ teamId: "team-123" });
        expect(result.count).toBe(1000);
        expect(result.maxMessagesPerMonth).toBe(1000);
      });

      it("returns planName as 'free'", async () => {
        const result = await service.checkLimit({ teamId: "team-123" });
        expect(result.planName).toBe("free");
      });
    });

    describe("when count < maxMessagesPerMonth", () => {
      it("returns exceeded: false", async () => {
        vi.mocked(
          mockOrganizationRepository.getOrganizationIdByTeamId,
        ).mockResolvedValue("org-123");
        vi.mocked(mockOrganizationRepository.getProjectIds).mockResolvedValue([
          "proj-1",
        ]);
        mockEsClient.count.mockResolvedValue({ count: 500 });
        mockSubscriptionHandler.getActivePlan.mockResolvedValue({
          maxMessagesPerMonth: 1000,
        });

        const result = await service.checkLimit({ teamId: "team-123" });

        expect(result.exceeded).toBe(false);
      });
    });

    describe("when self-hosted (IS_SAAS=false) with FREE_PLAN", () => {
      beforeEach(() => {
        vi.mocked(
          mockOrganizationRepository.getOrganizationIdByTeamId,
        ).mockResolvedValue("org-123");
        vi.mocked(mockOrganizationRepository.getProjectIds).mockResolvedValue([
          "proj-1",
        ]);
        mockEsClient.count.mockResolvedValue({ count: 5000 }); // Over any limit
        mockSubscriptionHandler.getActivePlan.mockResolvedValue(FREE_PLAN);
      });

      it("returns exceeded: false regardless of count", async () => {
        const { env } = await import("~/env.mjs");
        vi.mocked(env).IS_SAAS = false;

        const result = await service.checkLimit({ teamId: "team-123" });

        expect(result.exceeded).toBe(false);

        // Reset for other tests
        vi.mocked(env).IS_SAAS = true;
      });

      it("still fetches organization and plan to determine if FREE_PLAN", async () => {
        const { env } = await import("~/env.mjs");
        vi.mocked(env).IS_SAAS = false;

        await service.checkLimit({ teamId: "team-123" });

        expect(
          mockOrganizationRepository.getOrganizationIdByTeamId,
        ).toHaveBeenCalledWith("team-123");
        expect(mockSubscriptionHandler.getActivePlan).toHaveBeenCalledWith(
          "org-123",
        );

        // Reset for other tests
        vi.mocked(env).IS_SAAS = true;
      });
    });
  });

  describe("getCurrentMonthCount", () => {
    describe("when organization has no projects", () => {
      it("returns 0 without querying ES", async () => {
        vi.mocked(mockOrganizationRepository.getProjectIds).mockResolvedValue(
          [],
        );

        const result = await service.getCurrentMonthCount({
          organizationId: "org-123",
        });

        expect(result).toBe(0);
        expect(mockEsClientFactory).not.toHaveBeenCalled();
      });
    });

    describe("when organization has projects", () => {
      it("sums counts from all projects", async () => {
        vi.mocked(mockOrganizationRepository.getProjectIds).mockResolvedValue([
          "proj-1",
          "proj-2",
        ]);
        mockEsClient.count.mockResolvedValue({ count: 42 });

        const result = await service.getCurrentMonthCount({
          organizationId: "org-123",
        });

        expect(result).toBe(84); // 42 per project * 2 projects
        expect(mockEsClientFactory).toHaveBeenCalledWith({
          organizationId: "org-123",
        });
      });
    });
  });
});
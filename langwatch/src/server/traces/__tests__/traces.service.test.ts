import { describe, it, expect, vi, beforeEach } from "vitest";
import { TracesService } from "../traces.service";
import type { OrganizationRepository } from "~/server/repositories/organization.repository";

describe("TracesService", () => {
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

  let service: TracesService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TracesService(
      mockOrganizationRepository,
      mockEsClientFactory,
      mockSubscriptionHandler as any
    );
  });

  describe("checkLimit", () => {
    describe("when organizationId is not found", () => {
      it("throws an error", async () => {
        vi.mocked(mockOrganizationRepository.getOrganizationIdByTeamId).mockResolvedValue(null);

        await expect(service.checkLimit({ teamId: "team-123" })).rejects.toThrow(
          "Team team-123 has no organization"
        );
      });
    });

    describe("when count >= maxMessagesPerMonth", () => {
      it("returns exceeded: true with message", async () => {
        vi.mocked(mockOrganizationRepository.getOrganizationIdByTeamId).mockResolvedValue("org-123");
        vi.mocked(mockOrganizationRepository.getProjectIds).mockResolvedValue(["proj-1"]);
        mockEsClient.count.mockResolvedValue({ count: 1000 });
        mockSubscriptionHandler.getActivePlan.mockResolvedValue({ maxMessagesPerMonth: 1000 });

        const result = await service.checkLimit({ teamId: "team-123" });

        expect(result.exceeded).toBe(true);
        expect(result.message).toBe("Monthly limit of 1000 traces reached");
      });
    });

    describe("when count < maxMessagesPerMonth", () => {
      it("returns exceeded: false", async () => {
        vi.mocked(mockOrganizationRepository.getOrganizationIdByTeamId).mockResolvedValue("org-123");
        vi.mocked(mockOrganizationRepository.getProjectIds).mockResolvedValue(["proj-1"]);
        mockEsClient.count.mockResolvedValue({ count: 500 });
        mockSubscriptionHandler.getActivePlan.mockResolvedValue({ maxMessagesPerMonth: 1000 });

        const result = await service.checkLimit({ teamId: "team-123" });

        expect(result.exceeded).toBe(false);
      });
    });
  });

  describe("getCurrentMonthCount", () => {
    describe("when organization has no projects", () => {
      it("returns 0 without querying ES", async () => {
        vi.mocked(mockOrganizationRepository.getProjectIds).mockResolvedValue([]);

        const result = await service.getCurrentMonthCount({ organizationId: "org-123" });

        expect(result).toBe(0);
        expect(mockEsClientFactory).not.toHaveBeenCalled();
      });
    });

    describe("when organization has projects", () => {
      it("queries ES with all project IDs", async () => {
        vi.mocked(mockOrganizationRepository.getProjectIds).mockResolvedValue(["proj-1", "proj-2"]);
        mockEsClient.count.mockResolvedValue({ count: 42 });

        const result = await service.getCurrentMonthCount({ organizationId: "org-123" });

        expect(result).toBe(42);
        expect(mockEsClientFactory).toHaveBeenCalledWith({ organizationId: "org-123" });
      });
    });
  });
});

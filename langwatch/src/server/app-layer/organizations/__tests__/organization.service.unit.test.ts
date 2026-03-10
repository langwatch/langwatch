import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrganizationRepository } from "../repositories/organization.repository";
import { OrganizationService } from "../organization.service";

// Bypass the traced() proxy for unit tests
vi.mock("../../tracing", () => ({
  traced: <T>(instance: T) => instance,
}));

describe("OrganizationService", () => {
  const mockRepo: OrganizationRepository = {
    getOrganizationIdByTeamId: vi.fn(),
    getProjectIds: vi.fn(),
    clearTrialLicense: vi.fn(),
    updateCurrency: vi.fn(),
  };

  let service: OrganizationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = Object.create(OrganizationService.prototype);
    Object.assign(service, { repo: mockRepo });
  });

  describe("getOrganizationIdByTeamId", () => {
    describe("when team exists", () => {
      it("returns the organizationId", async () => {
        vi.mocked(mockRepo.getOrganizationIdByTeamId).mockResolvedValue(
          "org-123",
        );

        const result =
          await service.getOrganizationIdByTeamId("team-456");

        expect(result).toBe("org-123");
        expect(mockRepo.getOrganizationIdByTeamId).toHaveBeenCalledWith(
          "team-456",
        );
      });
    });

    describe("when team does not exist", () => {
      it("returns null", async () => {
        vi.mocked(mockRepo.getOrganizationIdByTeamId).mockResolvedValue(null);

        const result =
          await service.getOrganizationIdByTeamId("nonexistent");

        expect(result).toBeNull();
      });
    });
  });

  describe("getProjectIds", () => {
    it("returns project IDs for the organization", async () => {
      vi.mocked(mockRepo.getProjectIds).mockResolvedValue([
        "proj-1",
        "proj-2",
      ]);

      const result = await service.getProjectIds("org-123");

      expect(result).toEqual(["proj-1", "proj-2"]);
      expect(mockRepo.getProjectIds).toHaveBeenCalledWith("org-123");
    });
  });
});

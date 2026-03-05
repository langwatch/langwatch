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
    getFeature: vi.fn(),
  };

  let service: OrganizationService;

  beforeEach(() => {
    vi.clearAllMocks();
    // Use the factory with null to get a NullOrganizationRepository,
    // then override with our mock via prototype hack — or better,
    // just test the service logic by constructing via reflection.
    // Since constructor is private, we test through the static create
    // and rely on the repo interface contract.

    // For unit testing, we access the private constructor via a test helper:
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

  describe("isFeatureEnabled", () => {
    describe("when feature row exists and is not expired", () => {
      it("returns true", async () => {
        vi.mocked(mockRepo.getFeature).mockResolvedValue({
          feature: "billable_events_usage",
          organizationId: "org-123",
          trialEndDate: null,
        });

        const result = await service.isFeatureEnabled(
          "org-123",
          "billable_events_usage",
        );

        expect(result).toBe(true);
      });
    });

    describe("when feature row exists with future trial end date", () => {
      it("returns true", async () => {
        const futureDate = new Date();
        futureDate.setFullYear(futureDate.getFullYear() + 1);

        vi.mocked(mockRepo.getFeature).mockResolvedValue({
          feature: "billable_events_usage",
          organizationId: "org-123",
          trialEndDate: futureDate,
        });

        const result = await service.isFeatureEnabled(
          "org-123",
          "billable_events_usage",
        );

        expect(result).toBe(true);
      });
    });

    describe("when no feature row exists", () => {
      it("returns false", async () => {
        vi.mocked(mockRepo.getFeature).mockResolvedValue(null);

        const result = await service.isFeatureEnabled(
          "org-123",
          "billable_events_usage",
        );

        expect(result).toBe(false);
      });
    });

    describe("when feature trial has expired", () => {
      it("returns false", async () => {
        const pastDate = new Date();
        pastDate.setFullYear(pastDate.getFullYear() - 1);

        vi.mocked(mockRepo.getFeature).mockResolvedValue({
          feature: "billable_events_usage",
          organizationId: "org-123",
          trialEndDate: pastDate,
        });

        const result = await service.isFeatureEnabled(
          "org-123",
          "billable_events_usage",
        );

        expect(result).toBe(false);
      });
    });
  });
});

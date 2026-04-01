import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrganizationUserRole, TeamUserRole } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import type { OrganizationRepository } from "../repositories/organization.repository";
import { OrganizationService } from "../organization.service";
import type { PromptTagRepository } from "~/server/prompt-config/repositories/prompt-tag.repository";

// Bypass the traced() proxy for unit tests
vi.mock("../../tracing", () => ({
  traced: <T>(instance: T) => instance,
}));

describe("OrganizationService", () => {
  const mockRepo: OrganizationRepository = {
    getOrganizationIdByTeamId: vi.fn(),
    getProjectIds: vi.fn(),
    getFeature: vi.fn(),
    findWithAdmins: vi.fn(),
    updateSentPlanLimitAlert: vi.fn(),
    findProjectsWithName: vi.fn(),
    clearTrialLicense: vi.fn(),
    updateCurrency: vi.fn(),
    getPricingModel: vi.fn(),
    getStripeCustomerId: vi.fn(),
    findNameById: vi.fn(),
    getOrganizationForBilling: vi.fn(),
    createAndAssign: vi.fn(),
    getAllForUser: vi.fn(),
    getOrganizationWithMembers: vi.fn(),
    getMemberById: vi.fn(),
    getAllMembers: vi.fn(),
    update: vi.fn(),
    deleteMember: vi.fn(),
    updateMemberRole: vi.fn(),
    updateTeamMemberRole: vi.fn(),
    getAuditLogs: vi.fn(),
  };

  const mockPromptTagRepo = {
    seedForOrg: vi.fn(),
  } as unknown as PromptTagRepository;

  let service: OrganizationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new OrganizationService(mockRepo, mockPromptTagRepo);
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

  describe("updateMemberRole", () => {
    const baseParams = {
      organizationId: "org-123",
      userId: "user-456",
      role: OrganizationUserRole.MEMBER,
      currentMemberships: [{ teamId: "team-1", role: TeamUserRole.VIEWER }],
      organizationTeamIds: ["team-1", "team-2"],
      currentUserId: "admin-789",
    };

    beforeEach(() => {
      vi.mocked(mockRepo.updateMemberRole).mockResolvedValue(undefined);
    });

    describe("when a team role update targets a different user", () => {
      it("throws BAD_REQUEST", async () => {
        await expect(
          service.updateMemberRole({
            ...baseParams,
            teamRoleUpdates: [
              { teamId: "team-1", userId: "wrong-user", role: TeamUserRole.MEMBER },
            ],
          }),
        ).rejects.toThrow(TRPCError);

        await expect(
          service.updateMemberRole({
            ...baseParams,
            teamRoleUpdates: [
              { teamId: "team-1", userId: "wrong-user", role: TeamUserRole.MEMBER },
            ],
          }),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      });
    });

    describe("when a team role update references a team outside the organization", () => {
      it("throws BAD_REQUEST", async () => {
        await expect(
          service.updateMemberRole({
            ...baseParams,
            teamRoleUpdates: [
              { teamId: "team-outside", userId: "user-456", role: TeamUserRole.MEMBER },
            ],
          }),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      });
    });

    describe("when inputs are valid", () => {
      it("delegates to the repository with effective team role updates", async () => {
        await service.updateMemberRole({
          ...baseParams,
          teamRoleUpdates: [
            { teamId: "team-1", userId: "user-456", role: TeamUserRole.ADMIN },
          ],
        });

        expect(mockRepo.updateMemberRole).toHaveBeenCalledWith(
          expect.objectContaining({
            organizationId: "org-123",
            userId: "user-456",
            role: OrganizationUserRole.MEMBER,
            effectiveTeamRoleUpdates: expect.arrayContaining([
              expect.objectContaining({ teamId: "team-1", role: TeamUserRole.ADMIN }),
            ]),
          }),
        );
      });
    });
  });

  describe("updateTeamMemberRole", () => {
    beforeEach(() => {
      vi.mocked(mockRepo.updateTeamMemberRole).mockResolvedValue(undefined);
    });

    describe("when role is a custom role and customRoleId is missing", () => {
      it("throws BAD_REQUEST", async () => {
        await expect(
          service.updateTeamMemberRole({
            teamId: "team-1",
            userId: "user-456",
            role: "custom:some-role",
            customRoleId: undefined,
            currentUserId: "admin-789",
          }),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      });
    });

    describe("when role is a custom role and customRoleId is provided", () => {
      it("delegates to the repository with customRoleId", async () => {
        await service.updateTeamMemberRole({
          teamId: "team-1",
          userId: "user-456",
          role: "custom:some-role",
          customRoleId: "role-abc",
          currentUserId: "admin-789",
        });

        expect(mockRepo.updateTeamMemberRole).toHaveBeenCalledWith(
          expect.objectContaining({ customRoleId: "role-abc" }),
        );
      });
    });

    describe("when role is a built-in role", () => {
      it("delegates to the repository without customRoleId", async () => {
        await service.updateTeamMemberRole({
          teamId: "team-1",
          userId: "user-456",
          role: TeamUserRole.ADMIN,
          currentUserId: "admin-789",
        });

        expect(mockRepo.updateTeamMemberRole).toHaveBeenCalledWith(
          expect.objectContaining({ customRoleId: undefined }),
        );
      });
    });
  });
});

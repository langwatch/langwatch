import { OrganizationUserRole, TeamUserRole } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PromptTagRepository } from "~/server/prompt-config/repositories/prompt-tag.repository";
import { OrganizationService } from "../organization.service";
import type { OrganizationRepository } from "../repositories/organization.repository";

// Bypass the traced() proxy for unit tests
vi.mock("../../tracing", () => ({
  traced: <T>(instance: T) => instance,
}));

const { mockRevokeAllTraceShares } = vi.hoisted(() => ({
  mockRevokeAllTraceShares: vi.fn(),
}));

// The service reaches the app singleton only for cross-aggregate effects
// (trace-share revocation, plan resolution); pin the one this suite drives.
vi.mock("../../app", () => ({
  getApp: () => ({
    share: { revokeAllTraceShares: mockRevokeAllTraceShares },
  }),
}));

describe("OrganizationService", () => {
  const mockRepo: OrganizationRepository = {
    getOrganizationIdByTeamId: vi.fn(),
    getUserOrgRole: vi.fn(),
    getUserOrgRoleByTeamId: vi.fn(),
    getProjectIds: vi.fn(),
    findPrimaryIntentById: vi.fn(),
    findWithAdmins: vi.fn(),
    updateSentPlanLimitAlert: vi.fn(),
    findProjectsWithName: vi.fn(),
    clearTrialLicense: vi.fn(),
    updateCurrency: vi.fn(),
    getPricingModel: vi.fn(),
    getStripeCustomerId: vi.fn(),
    findByStripeCustomerId: vi.fn(),
    findNameById: vi.fn(),
    getOrganizationForBilling: vi.fn(),
    createAndAssign: vi.fn(),
    getAllForUser: vi.fn(),
    getOrganizationWithMembers: vi.fn(),
    getMemberById: vi.fn(),
    getAllMembers: vi.fn(),
    findMembership: vi.fn(),
    listMembers: vi.fn(),
    findMemberTeamBindings: vi.fn(),
    findSettingsById: vi.fn(),
    updateSettings: vi.fn(),
    deleteMember: vi.fn(),
    setMemberDisabled: vi.fn(),
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

        const result = await service.getOrganizationIdByTeamId("team-456");

        expect(result).toBe("org-123");
        expect(mockRepo.getOrganizationIdByTeamId).toHaveBeenCalledWith(
          "team-456",
        );
      });
    });

    describe("when team does not exist", () => {
      it("returns null", async () => {
        vi.mocked(mockRepo.getOrganizationIdByTeamId).mockResolvedValue(null);

        const result = await service.getOrganizationIdByTeamId("nonexistent");

        expect(result).toBeNull();
      });
    });
  });

  describe("getProjectIds", () => {
    it("returns project IDs for the organization", async () => {
      vi.mocked(mockRepo.getProjectIds).mockResolvedValue(["proj-1", "proj-2"]);

      const result = await service.getProjectIds("org-123");

      expect(result).toEqual(["proj-1", "proj-2"]);
      expect(mockRepo.getProjectIds).toHaveBeenCalledWith("org-123");
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
      vi.mocked(mockRepo.updateMemberRole).mockResolvedValue({
        teamsLeftWithoutAdmin: [],
      });
    });

    describe("when a team role update targets a different user", () => {
      it("throws BAD_REQUEST", async () => {
        await expect(
          service.updateMemberRole({
            ...baseParams,
            teamRoleUpdates: [
              {
                teamId: "team-1",
                userId: "wrong-user",
                role: TeamUserRole.MEMBER,
              },
            ],
          }),
        ).rejects.toThrow(TRPCError);

        await expect(
          service.updateMemberRole({
            ...baseParams,
            teamRoleUpdates: [
              {
                teamId: "team-1",
                userId: "wrong-user",
                role: TeamUserRole.MEMBER,
              },
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
              {
                teamId: "team-outside",
                userId: "user-456",
                role: TeamUserRole.MEMBER,
              },
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
              expect.objectContaining({
                teamId: "team-1",
                role: TeamUserRole.ADMIN,
              }),
            ]),
          }),
        );
      });
    });
  });

  describe("deleteMember", () => {
    const membership = {
      userId: "user-456",
      organizationId: "org-123",
      role: OrganizationUserRole.MEMBER,
      disabledAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      user: { id: "user-456", name: "Member", email: "member@example.com" },
    };

    describe("when the acting user removes themselves", () => {
      it("refuses with cannot_remove_self before touching the repository", async () => {
        await expect(
          service.deleteMember({
            organizationId: "org-123",
            userId: "user-456",
            actingUserId: "user-456",
          }),
        ).rejects.toMatchObject({ code: "cannot_remove_self" });

        expect(mockRepo.findMembership).not.toHaveBeenCalled();
        expect(mockRepo.deleteMember).not.toHaveBeenCalled();
      });
    });

    describe("when the membership does not exist", () => {
      it("refuses with member_not_found", async () => {
        vi.mocked(mockRepo.findMembership).mockResolvedValue(null);

        await expect(
          service.deleteMember({
            organizationId: "org-123",
            userId: "user-456",
            actingUserId: "admin-789",
          }),
        ).rejects.toMatchObject({ code: "member_not_found" });

        expect(mockRepo.deleteMember).not.toHaveBeenCalled();
      });
    });

    describe("when another member is removed", () => {
      it("delegates to the repository", async () => {
        vi.mocked(mockRepo.findMembership).mockResolvedValue(membership);

        await service.deleteMember({
          organizationId: "org-123",
          userId: "user-456",
          actingUserId: "admin-789",
        });

        expect(mockRepo.deleteMember).toHaveBeenCalledWith({
          organizationId: "org-123",
          userId: "user-456",
        });
      });
    });

    describe("when the credential acts as nobody", () => {
      it("cannot trip the self-removal guard", async () => {
        vi.mocked(mockRepo.findMembership).mockResolvedValue(membership);

        await service.deleteMember({
          organizationId: "org-123",
          userId: "user-456",
        });

        expect(mockRepo.deleteMember).toHaveBeenCalled();
      });
    });
  });

  describe("setMemberDisabled", () => {
    describe("when the acting user disables themselves", () => {
      it("refuses with cannot_disable_self", async () => {
        await expect(
          service.setMemberDisabled({
            organizationId: "org-123",
            userId: "user-456",
            disabled: true,
            actingUser: { id: "user-456" },
          }),
        ).rejects.toMatchObject({ code: "cannot_disable_self" });

        expect(mockRepo.setMemberDisabled).not.toHaveBeenCalled();
      });
    });

    describe("when the membership does not exist", () => {
      it("refuses with member_not_found", async () => {
        vi.mocked(mockRepo.findMembership).mockResolvedValue(null);

        await expect(
          service.setMemberDisabled({
            organizationId: "org-123",
            userId: "ghost",
            disabled: true,
            actingUser: { id: "admin-789" },
          }),
        ).rejects.toMatchObject({ code: "member_not_found" });
      });
    });

    describe("when disabling another member", () => {
      it("delegates to the repository without a seat check", async () => {
        vi.mocked(mockRepo.findMembership).mockResolvedValue({
          userId: "user-456",
          organizationId: "org-123",
          role: OrganizationUserRole.MEMBER,
          disabledAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          user: { id: "user-456", name: null, email: null },
        });

        await service.setMemberDisabled({
          organizationId: "org-123",
          userId: "user-456",
          disabled: true,
          actingUser: { id: "admin-789" },
        });

        expect(mockRepo.setMemberDisabled).toHaveBeenCalledWith({
          organizationId: "org-123",
          userId: "user-456",
          disabled: true,
        });
      });
    });
  });

  describe("getMember", () => {
    describe("when the user is not a member", () => {
      it("refuses with member_not_found", async () => {
        vi.mocked(mockRepo.findMembership).mockResolvedValue(null);

        await expect(
          service.getMember({ organizationId: "org-123", userId: "ghost" }),
        ).rejects.toMatchObject({ code: "member_not_found" });
      });
    });

    describe("when the member exists", () => {
      it("returns the membership with its team bindings", async () => {
        vi.mocked(mockRepo.findMembership).mockResolvedValue({
          userId: "user-456",
          organizationId: "org-123",
          role: OrganizationUserRole.MEMBER,
          disabledAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          user: { id: "user-456", name: "Member", email: "m@example.com" },
        });
        vi.mocked(mockRepo.findMemberTeamBindings).mockResolvedValue([
          {
            teamId: "team-1",
            teamName: "Core",
            role: TeamUserRole.MEMBER,
            customRoleId: null,
            customRoleName: null,
          },
        ]);

        const member = await service.getMember({
          organizationId: "org-123",
          userId: "user-456",
        });

        expect(member.role).toBe(OrganizationUserRole.MEMBER);
        expect(member.teams).toEqual([
          {
            teamId: "team-1",
            teamName: "Core",
            role: TeamUserRole.MEMBER,
            customRoleId: null,
            customRoleName: null,
          },
        ]);
      });
    });
  });

  describe("updateSettings", () => {
    describe("when trace sharing is turned off", () => {
      it("revokes every project's existing trace shares (ADR-057)", async () => {
        vi.mocked(mockRepo.findSettingsById).mockResolvedValue({
          id: "org-123",
          name: "Org",
          slug: "org",
          supportContact: null,
          presenceEnabled: true,
          traceSharingEnabled: true,
          primaryIntent: null,
          s3Endpoint: null,
          s3AccessKeyId: null,
          s3Bucket: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        vi.mocked(mockRepo.getProjectIds).mockResolvedValue([
          "proj-1",
          "proj-2",
        ]);

        await service.updateSettings({
          organizationId: "org-123",
          traceSharingEnabled: false,
        });

        expect(mockRepo.updateSettings).toHaveBeenCalledWith({
          organizationId: "org-123",
          traceSharingEnabled: false,
        });
        expect(mockRevokeAllTraceShares).toHaveBeenCalledTimes(2);
        expect(mockRevokeAllTraceShares).toHaveBeenCalledWith("proj-1");
        expect(mockRevokeAllTraceShares).toHaveBeenCalledWith("proj-2");
      });
    });

    describe("when trace sharing was already off", () => {
      it("does not revoke anything again", async () => {
        vi.mocked(mockRepo.findSettingsById).mockResolvedValue({
          id: "org-123",
          name: "Org",
          slug: "org",
          supportContact: null,
          presenceEnabled: true,
          traceSharingEnabled: false,
          primaryIntent: null,
          s3Endpoint: null,
          s3AccessKeyId: null,
          s3Bucket: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        await service.updateSettings({
          organizationId: "org-123",
          traceSharingEnabled: false,
        });

        expect(mockRevokeAllTraceShares).not.toHaveBeenCalled();
      });
    });

    describe("when the update does not touch trace sharing", () => {
      it("writes the partial update without reading the stored settings", async () => {
        await service.updateSettings({
          organizationId: "org-123",
          name: "Renamed Org",
        });

        expect(mockRepo.updateSettings).toHaveBeenCalledWith({
          organizationId: "org-123",
          name: "Renamed Org",
        });
        expect(mockRepo.findSettingsById).not.toHaveBeenCalled();
        expect(mockRevokeAllTraceShares).not.toHaveBeenCalled();
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

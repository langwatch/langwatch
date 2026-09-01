import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrganizationUserRole, type PrismaClient, TeamUserRole } from "~/generated/prisma/client";
import type { PromptService } from "@langwatch/prompt-contract";
import type { ShareService } from "@langwatch/share-contract";
import type { LicenseEnforcementService } from "~/server/license-enforcement";
import type { OrganizationService as OrganizationServiceContract } from "@langwatch/organization-contract";
import { OrganizationService } from "../organization.service";
import type { OrganizationRepository } from "../repositories/organization.repository";

// Bypass the traced() proxy for unit tests
vi.mock("../../tracing", () => ({
  traced: <T>(instance: T) => instance,
}));

const { mockRevokeAllTraceShares, mockCheckLimit, mockInvalidateOrganization } = vi.hoisted(() => ({
  mockInvalidateOrganization: vi.fn(),
  mockRevokeAllTraceShares: vi.fn(),
  mockCheckLimit: vi.fn(),
}));

// Disabling a seat is not a grant write, so the service retires the
// organization's cached authorization snapshots itself.
vi.mock("../../app", () => ({
  getApp: () => ({
    authzGrants: { invalidateOrganization: mockInvalidateOrganization },
  }),
}));

// The seat check on re-enabling a membership. The service used to build this
// itself from the repository's client, which is what the module mock that
// stood here answered; it now takes one as a constructor argument, so the mock
// was mocking a factory nobody called and `licenseEnforcement` was undefined.
// Injected below instead.

describe("OrganizationService", () => {
  const mockRepo: OrganizationRepository = {
    getClient: vi.fn(),
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
    createForProvisioning: vi.fn(),
    findAllProvisioningSummaries: vi.fn(),
    findProvisioningSummaryById: vi.fn(),
    deleteProvisionedOrganization: vi.fn(),
    getAllForUser: vi.fn(),
    getOrganizationWithMembers: vi.fn(),
    getMemberById: vi.fn(),
    getAllMembers: vi.fn(),
    findMembership: vi.fn(),
    findAllMembers: vi.fn(),
    findMemberTeamBindings: vi.fn(),
    deleteMember: vi.fn(),
    setMemberDisabled: vi.fn(),
    updateMemberRole: vi.fn(),
    updateTeamMemberRole: vi.fn(),
    getAuditLogs: vi.fn(),
  };

  const mockPrompts = {
    seedTagsForOrganization: vi.fn(),
  } as Pick<PromptService, "seedTagsForOrganization">;
  const mockShares = {
    revokeAllTraceShares: mockRevokeAllTraceShares,
  } as unknown as ShareService;
  // Settings are the organization feature's, so the service under test reaches
  // the canonical contract for them rather than its own repository.
  const mockCanonicalGetSettings = vi.fn();
  const mockCanonicalUpdateSettings = vi.fn();
  const mockCanonicalTryGetOrganizationIdByTeamId = vi.fn();
  // Disabling a seat revokes the live session through the canonical Auth
  // service; the service resolves it lazily, so the double is a thunk too.
  const mockRevokeAllBrowserSessions = vi.fn();
  const mockCanonical = {
    getSettings: mockCanonicalGetSettings,
    updateSettings: mockCanonicalUpdateSettings,
    tryGetOrganizationIdByTeamId: mockCanonicalTryGetOrganizationIdByTeamId,
  } as unknown as OrganizationServiceContract;

  let service: OrganizationService;

  beforeEach(() => {
    vi.clearAllMocks();
    // The flows that compose raw-client helpers ask the repository for its
    // client; the double is Prisma-backed as far as they are concerned.
    vi.mocked(mockRepo.getClient!).mockReturnValue({} as unknown as PrismaClient);
    mockCanonicalUpdateSettings.mockResolvedValue({ traceShareRevocationRequired: false });
    service = new OrganizationService(
      mockRepo,
      mockPrompts,
      mockCanonical,
      { checkLimit: mockCheckLimit } as unknown as LicenseEnforcementService,
      mockShares,
      () => ({ revokeAllBrowserSessions: mockRevokeAllBrowserSessions }),
    );
  });

  describe("tryGetOrganizationIdByTeamId", () => {
    describe("when the team exists", () => {
      it("returns the organization the feature answers with", async () => {
        mockCanonicalTryGetOrganizationIdByTeamId.mockResolvedValue("org-123");

        const result = await service.tryGetOrganizationIdByTeamId({ teamId: "team-456" });

        expect(result).toBe("org-123");
        expect(mockCanonicalTryGetOrganizationIdByTeamId).toHaveBeenCalledWith({
          teamId: "team-456",
        });
      });
    });

    describe("when the team does not exist", () => {
      it("returns null rather than refusing", async () => {
        mockCanonicalTryGetOrganizationIdByTeamId.mockResolvedValue(null);

        const result = await service.tryGetOrganizationIdByTeamId({ teamId: "nonexistent" });

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
          teamRoleUpdates: [{ teamId: "team-1", userId: "user-456", role: TeamUserRole.ADMIN }],
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

  describe("when removing a member", () => {
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

        // The acting user travels with the removal: the grant revocation it
        // emits is attributed to whoever made the decision.
        expect(mockRepo.deleteMember).toHaveBeenCalledWith({
          organizationId: "org-123",
          userId: "user-456",
          actingUserId: "admin-789",
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

  describe("when changing a member's disabled state", () => {
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

    describe("when the seat is taken away", () => {
      const activeMember = {
        userId: "user-456",
        organizationId: "org-123",
        role: OrganizationUserRole.MEMBER,
        disabledAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        user: { id: "user-456", name: null, email: null },
      };

      /** @scenario "Disabling a member revokes their live browser sessions" */
      it("revokes every browser session that member holds", async () => {
        vi.mocked(mockRepo.findMembership).mockResolvedValue(activeMember);

        await service.setMemberDisabled({
          organizationId: "org-123",
          userId: "user-456",
          disabled: true,
          actingUser: { id: "admin-789" },
        });

        // The membership write comes first: signing them out and then failing
        // the write would lock out a member whose seat was never revoked.
        expect(mockRepo.setMemberDisabled).toHaveBeenCalled();
        expect(mockRevokeAllBrowserSessions).toHaveBeenCalledWith({ userId: "user-456" });
      });

      /** @scenario "Re-enabling a member revokes nothing" */
      it("revokes nothing when the seat is given back", async () => {
        vi.mocked(mockRepo.findMembership).mockResolvedValue({
          ...activeMember,
          disabledAt: new Date("2026-08-01T00:00:00Z"),
        });
        mockCheckLimit.mockResolvedValue({
          allowed: true,
          limitType: "members",
          current: 1,
          max: 5,
        });

        await service.setMemberDisabled({
          organizationId: "org-123",
          userId: "user-456",
          disabled: false,
          actingUser: { id: "admin-789" },
        });

        expect(mockRevokeAllBrowserSessions).not.toHaveBeenCalled();
      });

      /** @scenario "A process without a session owner refuses the disable" */
      it("refuses the disable when no session owner was composed", async () => {
        const withoutAuth = new OrganizationService(mockRepo, mockPrompts, mockCanonical, {
          checkLimit: mockCheckLimit,
        } as unknown as LicenseEnforcementService);
        vi.mocked(mockRepo.findMembership).mockResolvedValue(activeMember);

        await expect(
          withoutAuth.setMemberDisabled({
            organizationId: "org-123",
            userId: "user-456",
            disabled: true,
            actingUser: { id: "admin-789" },
          }),
        ).rejects.toThrow("Auth service is not configured");
      });
    });

    describe("when disabling another member", () => {
      /** @scenario Disabling or re-enabling a membership takes effect on the next request */
      it("retires the organization's cached authorization answers", async () => {
        // Disabling writes a column, not a grant, so nothing else bumps the
        // authz epoch. Without this the revocation an admin just performed
        // stays invisible to any cached snapshot until it ages out.
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

        expect(mockInvalidateOrganization).toHaveBeenCalledWith({
          organizationId: "org-123",
        });
      });

      /** @scenario Disabling or re-enabling a membership takes effect on the next request */
      it("retires them again on re-enable, so nobody waits out a cache to get back in", async () => {
        vi.mocked(mockRepo.findMembership).mockResolvedValue({
          userId: "user-456",
          organizationId: "org-123",
          role: OrganizationUserRole.MEMBER,
          disabledAt: new Date("2026-08-01T00:00:00Z"),
          createdAt: new Date(),
          updatedAt: new Date(),
          user: { id: "user-456", name: null, email: null },
        });
        mockCheckLimit.mockResolvedValue({
          allowed: true,
          limitType: "members",
          current: 1,
          max: 5,
        });

        await service.setMemberDisabled({
          organizationId: "org-123",
          userId: "user-456",
          disabled: false,
          actingUser: { id: "admin-789" },
        });

        expect(mockInvalidateOrganization).toHaveBeenCalledWith({
          organizationId: "org-123",
        });
      });

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
        // Disabling frees a seat, so consulting the seat limit here would
        // refuse the very action that makes room. Named, or a regression that
        // adds the check still passes this test.
        expect(mockCheckLimit).not.toHaveBeenCalled();
      });
    });

    describe("when re-enabling a member the plan has no seat for", () => {
      it("refuses with member_seat_limit_reached", async () => {
        vi.mocked(mockRepo.findMembership).mockResolvedValue({
          userId: "user-456",
          organizationId: "org-123",
          role: OrganizationUserRole.MEMBER,
          disabledAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          user: { id: "user-456", name: null, email: null },
        });
        mockCheckLimit.mockResolvedValue({
          allowed: false,
          limitType: "members",
          current: 5,
          max: 5,
        });

        await expect(
          service.setMemberDisabled({
            organizationId: "org-123",
            userId: "user-456",
            disabled: false,
            actingUser: { id: "admin-789" },
          }),
        ).rejects.toMatchObject({ code: "member_seat_limit_reached" });

        expect(mockRepo.setMemberDisabled).not.toHaveBeenCalled();
      });
    });

    describe("when re-enabling a member the plan has a seat for", () => {
      it("delegates to the repository", async () => {
        vi.mocked(mockRepo.findMembership).mockResolvedValue({
          userId: "user-456",
          organizationId: "org-123",
          role: OrganizationUserRole.MEMBER,
          disabledAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          user: { id: "user-456", name: null, email: null },
        });
        mockCheckLimit.mockResolvedValue({
          allowed: true,
          limitType: "members",
          current: 1,
          max: 5,
        });

        await service.setMemberDisabled({
          organizationId: "org-123",
          userId: "user-456",
          disabled: false,
          actingUser: { id: "admin-789" },
        });

        expect(mockRepo.setMemberDisabled).toHaveBeenCalledWith({
          organizationId: "org-123",
          userId: "user-456",
          disabled: false,
        });
      });
    });
  });

  describe("when reading one member", () => {
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

  describe("when reading organization settings", () => {
    it("answers from the organization feature rather than a second copy", async () => {
      const settings = {
        id: "org-123",
        name: "Org",
        slug: "org",
        supportContact: null,
        presenceEnabled: true,
        traceSharingEnabled: true,
        primaryIntent: null,
        s3Endpoint: "https://storage.example.com",
        s3AccessKeyId: "access-key",
        s3Bucket: "bucket",
        createdAt: new Date(1),
        updatedAt: new Date(2),
      };
      mockCanonicalGetSettings.mockResolvedValue(settings);

      await expect(service.getSettings({ organizationId: "org-123" })).resolves.toBe(settings);

      expect(mockCanonicalGetSettings).toHaveBeenCalledWith({ organizationId: "org-123" });
    });
  });

  describe("when updating organization settings", () => {
    describe("when the write reports that trace sharing was turned off", () => {
      it("revokes every project's existing trace shares (ADR-057)", async () => {
        mockCanonicalUpdateSettings.mockResolvedValue({
          traceShareRevocationRequired: true,
        });
        vi.mocked(mockRepo.getProjectIds).mockResolvedValue(["proj-1", "proj-2"]);

        const result = await service.updateSettings({
          organizationId: "org-123",
          traceSharingEnabled: false,
        });

        expect(mockCanonicalUpdateSettings).toHaveBeenCalledWith({
          organizationId: "org-123",
          traceSharingEnabled: false,
        });
        expect(mockRevokeAllTraceShares).toHaveBeenCalledTimes(2);
        expect(mockRevokeAllTraceShares).toHaveBeenCalledWith("proj-1");
        expect(mockRevokeAllTraceShares).toHaveBeenCalledWith("proj-2");
        // Reported onward, so a door that repeats the pass stays idempotent.
        expect(result).toEqual({ traceShareRevocationRequired: true });
      });

      it("names every project whose share links survived the pass", async () => {
        mockCanonicalUpdateSettings.mockResolvedValue({
          traceShareRevocationRequired: true,
        });
        vi.mocked(mockRepo.getProjectIds).mockResolvedValue(["proj-1", "proj-2"]);
        mockRevokeAllTraceShares.mockImplementation((projectId: string) =>
          projectId === "proj-2" ? Promise.reject(new Error("nope")) : Promise.resolve(),
        );

        await expect(
          service.updateSettings({
            organizationId: "org-123",
            traceSharingEnabled: false,
          }),
        ).rejects.toThrow("proj-2");

        // Settled, not `all`: the first rejection must not skip the rest.
        expect(mockRevokeAllTraceShares).toHaveBeenCalledTimes(2);
      });
    });

    describe("when the write reports nothing to revoke", () => {
      it("revokes nothing and never enumerates the projects", async () => {
        mockCanonicalUpdateSettings.mockResolvedValue({
          traceShareRevocationRequired: false,
        });

        const result = await service.updateSettings({
          organizationId: "org-123",
          name: "Renamed Org",
        });

        expect(mockCanonicalUpdateSettings).toHaveBeenCalledWith({
          organizationId: "org-123",
          name: "Renamed Org",
        });
        expect(mockRepo.getProjectIds).not.toHaveBeenCalled();
        expect(mockRevokeAllTraceShares).not.toHaveBeenCalled();
        expect(result).toEqual({ traceShareRevocationRequired: false });
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

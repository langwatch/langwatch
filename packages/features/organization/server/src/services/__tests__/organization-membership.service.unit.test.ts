/**
 * The membership half's rules, over doubled ports.
 *
 * Moved with the service out of the platform application. Three of its groups
 * did not come: `tryGetOrganizationIdByTeamId`, `getProjectIds` and the
 * settings read/write were delegations to the canonical organization service,
 * which the package owns and covers on its own side.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  OrganizationUserRole,
  type PrismaClient,
  TeamUserRole,
} from "@langwatch/prisma-client/generated";
import { OrganizationMembershipService } from "../organization-membership.service";
import type {
  OrganizationGrantCachePort,
  OrganizationPromptSeedPort,
  OrganizationSeatLicensePort,
  OrganizationSessionRevocationPort,
} from "../../ports/organization-membership.port";
import type { OrganizationRepository } from "../../repositories/organization-membership.repository";

const mockInvalidateOrganization = vi.fn();
const mockCheckLimit = vi.fn();
const mockAssertRoleChangeAllowed = vi.fn();
const mockRevokeAllBrowserSessions = vi.fn();

describe("OrganizationMembershipService", () => {
  const mockRepo: OrganizationRepository = {
    getClient: vi.fn(),
    tryGetUserOrgRole: vi.fn(),
    getUserOrgRoleByTeamId: vi.fn(),
    tryFindPrimaryIntentById: vi.fn(),
    createAndAssign: vi.fn(),
    createForProvisioning: vi.fn(),
    findAllProvisioningSummaries: vi.fn(),
    tryFindProvisioningSummaryById: vi.fn(),
    deleteProvisionedOrganization: vi.fn(),
    getAllForUser: vi.fn(),
    getOrganizationWithMembers: vi.fn(),
    getMemberById: vi.fn(),
    getAllMembers: vi.fn(),
    tryFindMembership: vi.fn(),
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
    reportCompensationFailure: vi.fn(),
  } as unknown as OrganizationPromptSeedPort;
  const seats = {
    checkLimit: mockCheckLimit,
    assertRoleChangeAllowed: mockAssertRoleChangeAllowed,
  } as unknown as OrganizationSeatLicensePort;
  const sessions = {
    revokeAllBrowserSessions: mockRevokeAllBrowserSessions,
  } as unknown as OrganizationSessionRevocationPort;
  const grantCache = {
    invalidateOrganization: mockInvalidateOrganization,
  } as unknown as OrganizationGrantCachePort;

  let service: OrganizationMembershipService;

  beforeEach(() => {
    vi.clearAllMocks();
    // The flows that compose raw-client helpers ask the repository for its
    // client; the double is Prisma-backed as far as they are concerned.
    vi.mocked(mockRepo.getClient!).mockReturnValue({} as unknown as PrismaClient);
    service = OrganizationMembershipService.create({
      repository: mockRepo,
      prompts: mockPrompts,
      seats,
      sessions,
      grantCache,
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
      it("refuses with validation_error", async () => {
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
        ).rejects.toMatchObject({ code: "validation_error" });
      });
    });

    describe("when a team role update references a team outside the organization", () => {
      it("refuses with validation_error", async () => {
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
        ).rejects.toMatchObject({ code: "validation_error" });
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

        expect(mockRepo.tryFindMembership).not.toHaveBeenCalled();
        expect(mockRepo.deleteMember).not.toHaveBeenCalled();
      });
    });

    describe("when the membership does not exist", () => {
      it("refuses with member_not_found", async () => {
        vi.mocked(mockRepo.tryFindMembership).mockResolvedValue(null);

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
        vi.mocked(mockRepo.tryFindMembership).mockResolvedValue(membership);

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
        vi.mocked(mockRepo.tryFindMembership).mockResolvedValue(membership);

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
        vi.mocked(mockRepo.tryFindMembership).mockResolvedValue(null);

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
        vi.mocked(mockRepo.tryFindMembership).mockResolvedValue(activeMember);

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
        vi.mocked(mockRepo.tryFindMembership).mockResolvedValue({
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
        const withoutAuth = OrganizationMembershipService.create({
          repository: mockRepo,
          prompts: mockPrompts,
          seats,
          sessions: {
            revokeAllBrowserSessions: () =>
              Promise.reject(
                new Error("this process composes no session owner, so it cannot revoke sessions"),
              ),
          } as unknown as OrganizationSessionRevocationPort,
          grantCache,
        });
        vi.mocked(mockRepo.tryFindMembership).mockResolvedValue(activeMember);

        await expect(
          withoutAuth.setMemberDisabled({
            organizationId: "org-123",
            userId: "user-456",
            disabled: true,
            actingUser: { id: "admin-789" },
          }),
        ).rejects.toThrow("this process composes no session owner, so it cannot revoke sessions");
      });
    });

    describe("when disabling another member", () => {
      /** @scenario Disabling or re-enabling a membership takes effect on the next request */
      it("retires the organization's cached authorization answers", async () => {
        // Disabling writes a column, not a grant, so nothing else bumps the
        // authz epoch. Without this the revocation an admin just performed
        // stays invisible to any cached snapshot until it ages out.
        vi.mocked(mockRepo.tryFindMembership).mockResolvedValue({
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
        vi.mocked(mockRepo.tryFindMembership).mockResolvedValue({
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
        vi.mocked(mockRepo.tryFindMembership).mockResolvedValue({
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
        vi.mocked(mockRepo.tryFindMembership).mockResolvedValue({
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
        vi.mocked(mockRepo.tryFindMembership).mockResolvedValue({
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
        vi.mocked(mockRepo.tryFindMembership).mockResolvedValue(null);

        await expect(
          service.getMember({ organizationId: "org-123", userId: "ghost" }),
        ).rejects.toMatchObject({ code: "member_not_found" });
      });
    });

    describe("when the member exists", () => {
      it("returns the membership with its team bindings", async () => {
        vi.mocked(mockRepo.tryFindMembership).mockResolvedValue({
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

  describe("updateTeamMemberRole", () => {
    beforeEach(() => {
      vi.mocked(mockRepo.updateTeamMemberRole).mockResolvedValue(undefined);
    });

    describe("when role is a custom role and customRoleId is missing", () => {
      it("refuses with validation_error", async () => {
        await expect(
          service.updateTeamMemberRole({
            teamId: "team-1",
            userId: "user-456",
            role: "custom:some-role",
            customRoleId: undefined,
            currentUserId: "admin-789",
          }),
        ).rejects.toMatchObject({ code: "validation_error" });
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

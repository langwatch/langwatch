import { MemberNotFoundError } from "@langwatch/organization-contract";
import { OrganizationUserRole, TeamUserRole } from "@langwatch/prisma-client/generated";
/**
 * The membership half's rules, over doubled ports.
 */
import { nowInstant, Temporal } from "@langwatch/time";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  OrganizationGrantCache,
  OrganizationPromptSeed,
  OrganizationSeatLicense,
  OrganizationSessionRevocation,
} from "../../app/organization.members.ts";
import type { OrganizationMembershipRepository } from "../../repositories/organization-membership.repository.ts";
import {
  OrganizationMembershipService,
  type OrganizationTestArrivals,
} from "../organization-membership.service.ts";

const mockInvalidateOrganization = vi.fn();
const mockCheckLimit = vi.fn();
const mockAssertRoleChangeAllowed = vi.fn();
const mockRevokeAllBrowserSessions = vi.fn();
const mockCreateAndAssign = vi.fn();
const mockStandingFor = vi.fn<OrganizationTestArrivals["standingFor"]>(async () => ({
  testing: false,
}));

describe("OrganizationMembershipService", () => {
  const mockRepo: OrganizationMembershipRepository = {
    createMembership: vi.fn(),
    findPersonalTeamsInScopes: vi.fn(),
    findSharedTeamIds: vi.fn(),
    findTeamRoleBindings: vi.fn(),
    findCustomRolePermissions: vi.fn(),
    findUserOrgRoleByTeamId: vi.fn(),
    getOrganizationIntent: vi.fn(),
    findActiveAdministratorIds: vi.fn(),
    findMemberUserIds: vi.fn(),
    findInvitedMemberIds: vi.fn(),
    createAndAssign: mockCreateAndAssign,
    createForProvisioning: vi.fn(),
    findAllProvisioningSummaries: vi.fn(),
    getProvisioningSummaryById: vi.fn(),
    deleteProvisionedOrganization: vi.fn(),
    markSelfHostedCustomer: vi.fn(),
    findSelfHostedCustomers: vi.fn(),
    findRepresentatives: vi.fn(),
    findAllForUser: vi.fn(),
    findOrganizationWithMembers: vi.fn(),
    findMemberById: vi.fn(),
    findActiveMemberUsers: vi.fn(),
    findMemberUsersIncludingDeactivated: vi.fn(),
    findMemberDepartments: vi.fn(),
    findMemberTeamIds: vi.fn(),
    findMembersWithDepartments: vi.fn(),
    assignMemberDepartment: vi.fn(),
    findTeamsWithDepartments: vi.fn(),
    assignTeamDepartment: vi.fn(),
    getMembership: vi.fn(),
    listAllMembers: vi.fn(),
    findMemberTeamBindings: vi.fn(),
    deleteMember: vi.fn(),
    setMemberDisabled: vi.fn(),
    updateMemberRole: vi.fn(),
    updateTeamMemberRole: vi.fn(),
    getAuditLogs: vi.fn(),
  };

  const mockPrompts: OrganizationPromptSeed = {
    seedTagsForOrganization: vi.fn(),
    reportCompensationFailure: vi.fn(),
  };
  const seats: OrganizationSeatLicense = {
    checkLimit: mockCheckLimit,
    assertRoleChangeAllowed: mockAssertRoleChangeAllowed,
  };
  const sessions: OrganizationSessionRevocation = {
    revokeAllBrowserSessions: mockRevokeAllBrowserSessions,
  };
  const grantCache: OrganizationGrantCache = {
    invalidateOrganization: mockInvalidateOrganization,
  };
  /** Nobody here is mid-way through proving a connection; the one test that
   *  is says so itself. */
  const testArrivals = { standingFor: mockStandingFor };
  const attached: unknown[] = [];
  const completed: unknown[] = [];
  const admissions = {
    attachBindings: async (input: unknown) => {
      attached.push(input);
      return { attached: [], duplicates: [] };
    },
    completeAdmission: async (input: unknown) => {
      completed.push(input);
      return true;
    },
  };

  let service: OrganizationMembershipService;

  beforeEach(() => {
    vi.clearAllMocks();
    // The directory reads the role-change flow makes, answered empty unless a
    // test states otherwise.
    vi.mocked(mockRepo.findPersonalTeamsInScopes).mockResolvedValue([]);
    vi.mocked(mockRepo.findSharedTeamIds).mockResolvedValue([]);
    vi.mocked(mockRepo.findTeamRoleBindings).mockResolvedValue([]);
    vi.mocked(mockRepo.findCustomRolePermissions).mockResolvedValue([]);
    service = OrganizationMembershipService.create({
      repository: mockRepo,
      prompts: mockPrompts,
      seats,
      sessions,
      grantCache,
      testArrivals,
      admissions,
    });
    attached.length = 0;
    completed.length = 0;
  });

  describe("createAndAssign()", () => {
    /** @scenario "A test arrival is not sent to the screen that creates an organization" */
    it("refuses somebody mid-way through proving a connection", async () => {
      mockStandingFor.mockResolvedValueOnce({
        testing: true,
        connectionId: "local_ssoc_acme",
        organizationId: "org_acme",
        organizationName: "Acme",
      });

      await expect(
        service.createAndAssign({ userId: "user-456", orgName: "Acme" }),
      ).rejects.toMatchObject({ code: "sso_test_arrival_cannot_create_organization" });
      expect(mockCreateAndAssign).not.toHaveBeenCalled();
    });

    it("creates one for somebody who simply has no organization yet", async () => {
      mockCreateAndAssign.mockResolvedValue({
        organization: { id: "org-123" },
        team: { id: "team-123" },
      });

      await service.createAndAssign({ userId: "user-456", orgName: "Acme" });

      expect(mockCreateAndAssign).toHaveBeenCalledTimes(1);
    });
  });

  describe("when a join admits somebody", () => {
    it("lands the organization grant audited to the approving admin, then clears the marker", async () => {
      vi.mocked(mockRepo.createMembership).mockResolvedValue("created");

      await service.createMembership({
        organizationId: "org-123",
        userId: "user-456",
        admittedBy: { actor: { type: "user", id: "admin-1" }, commandId: "approve:jr-1" },
      });

      const [row] = vi.mocked(mockRepo.createMembership).mock.calls;
      const grantId = row?.[0].pendingAdmissionId;
      expect(attached).toEqual([
        expect.objectContaining({
          organizationId: "org-123",
          actor: { type: "user", id: "admin-1" },
          source: "join-request",
          commandId: "approve:jr-1",
          bindings: [
            expect.objectContaining({ bindingId: grantId, principal: { userId: "user-456" } }),
          ],
        }),
      ]);
      expect(completed).toEqual([{ organizationId: "org-123", userId: "user-456", grantId }]);
    });

    it("attaches nothing for somebody who was already a member", async () => {
      vi.mocked(mockRepo.createMembership).mockResolvedValue("already-present");

      await service.createMembership({
        organizationId: "org-123",
        userId: "user-456",
        admittedBy: { actor: { type: "system", id: "system:join-requests" }, commandId: "c-1" },
      });

      expect(attached).toEqual([]);
      expect(completed).toEqual([]);
    });
  });

  describe("createMembership()", () => {
    it("mints one admission intent per membership, in the ledger's own scheme", async () => {
      vi.mocked(mockRepo.createMembership).mockResolvedValue("created");

      await service.createMembership({ organizationId: "org-123", userId: "user-456" });
      await service.createMembership({ organizationId: "org-123", userId: "user-789" });

      const [first, second] = vi.mocked(mockRepo.createMembership).mock.calls;
      expect(first?.[0]).toMatchObject({ organizationId: "org-123", userId: "user-456" });
      expect(first?.[0].pendingAdmissionId).toMatch(/^rolebinding_/);
      expect(second?.[0].pendingAdmissionId).not.toBe(first?.[0].pendingAdmissionId);
    });

    it("reports a row a concurrent callback already created rather than refusing", async () => {
      vi.mocked(mockRepo.createMembership).mockResolvedValue("already-present");

      await expect(
        service.createMembership({ organizationId: "org-123", userId: "user-456" }),
      ).resolves.toBe("already-present");
    });
  });

  describe("updateMemberRole()", () => {
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

  describe("changeMemberRole()", () => {
    /**
     * The deployment answers `assertRoleChangeAllowed`, and its Enterprise
     * half refuses a change that hands out a custom team role on a plan that
     * does not carry custom roles. What this pins is the service's side of
     * that contract: the team role updates reach the gate, and a refusal stops
     * the write.
     * @scenario "Non-enterprise org cannot assign custom roles via member role update"
     */
    it("refuses before writing when the plan gate rejects a custom team role", async () => {
      vi.mocked(mockRepo.findSharedTeamIds).mockResolvedValue(["team-1"]);
      vi.mocked(mockRepo.getMembership).mockResolvedValue({
        role: OrganizationUserRole.MEMBER,
      } as never);
      const teamRoleUpdates = [
        {
          teamId: "team-1",
          userId: "user-456",
          role: "custom:auditor",
          customRoleId: "role-1",
        },
      ];
      mockAssertRoleChangeAllowed.mockRejectedValue(
        Object.assign(new Error("Custom roles require an Enterprise plan"), {
          code: "FORBIDDEN",
        }),
      );

      await expect(
        service.changeMemberRole({
          organizationId: "org-123",
          userId: "user-456",
          role: OrganizationUserRole.MEMBER,
          teamRoleUpdates,
          currentUserId: "admin-789",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      expect(mockAssertRoleChangeAllowed).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: "org-123", teamRoleUpdates }),
      );
      expect(mockRepo.updateMemberRole).not.toHaveBeenCalled();
    });
  });

  describe("when removing a member", () => {
    const membership = {
      userId: "user-456",
      organizationId: "org-123",
      role: OrganizationUserRole.MEMBER,
      disabledAt: null,
      createdAt: nowInstant(),
      updatedAt: nowInstant(),
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

        expect(mockRepo.getMembership).not.toHaveBeenCalled();
        expect(mockRepo.deleteMember).not.toHaveBeenCalled();
      });
    });

    describe("when the membership does not exist", () => {
      it("refuses with member_not_found", async () => {
        vi.mocked(mockRepo.getMembership).mockRejectedValue(new MemberNotFoundError("user-456"));

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
        vi.mocked(mockRepo.getMembership).mockResolvedValue(membership);

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
        vi.mocked(mockRepo.getMembership).mockResolvedValue(membership);

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
        vi.mocked(mockRepo.getMembership).mockRejectedValue(new MemberNotFoundError("user-456"));

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
        createdAt: nowInstant(),
        updatedAt: nowInstant(),
        user: { id: "user-456", name: null, email: null },
      };

      /** @scenario "Disabling a member revokes their live browser sessions" */
      it("revokes every browser session that member holds", async () => {
        vi.mocked(mockRepo.getMembership).mockResolvedValue(activeMember);

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
        vi.mocked(mockRepo.getMembership).mockResolvedValue({
          ...activeMember,
          disabledAt: Temporal.Instant.from("2026-08-01T00:00:00Z"),
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
          },
          grantCache,
          testArrivals,
          admissions,
        });
        vi.mocked(mockRepo.getMembership).mockResolvedValue(activeMember);

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
        vi.mocked(mockRepo.getMembership).mockResolvedValue({
          userId: "user-456",
          organizationId: "org-123",
          role: OrganizationUserRole.MEMBER,
          disabledAt: null,
          createdAt: nowInstant(),
          updatedAt: nowInstant(),
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
        vi.mocked(mockRepo.getMembership).mockResolvedValue({
          userId: "user-456",
          organizationId: "org-123",
          role: OrganizationUserRole.MEMBER,
          disabledAt: Temporal.Instant.from("2026-08-01T00:00:00Z"),
          createdAt: nowInstant(),
          updatedAt: nowInstant(),
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
        vi.mocked(mockRepo.getMembership).mockResolvedValue({
          userId: "user-456",
          organizationId: "org-123",
          role: OrganizationUserRole.MEMBER,
          disabledAt: null,
          createdAt: nowInstant(),
          updatedAt: nowInstant(),
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
      /** @scenario Re-enabling a member is refused when it would exceed the seats */
      it("refuses with member_seat_limit_reached", async () => {
        vi.mocked(mockRepo.getMembership).mockResolvedValue({
          userId: "user-456",
          organizationId: "org-123",
          role: OrganizationUserRole.MEMBER,
          disabledAt: nowInstant(),
          createdAt: nowInstant(),
          updatedAt: nowInstant(),
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
      /** @scenario A disabled member can be re-enabled when a seat is free */
      it("delegates to the repository", async () => {
        vi.mocked(mockRepo.getMembership).mockResolvedValue({
          userId: "user-456",
          organizationId: "org-123",
          role: OrganizationUserRole.MEMBER,
          disabledAt: nowInstant(),
          createdAt: nowInstant(),
          updatedAt: nowInstant(),
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
        vi.mocked(mockRepo.getMembership).mockRejectedValue(new MemberNotFoundError("user-456"));

        await expect(
          service.getMember({ organizationId: "org-123", userId: "ghost" }),
        ).rejects.toMatchObject({ code: "member_not_found" });
      });
    });

    describe("when the member exists", () => {
      it("returns the membership with its team bindings", async () => {
        vi.mocked(mockRepo.getMembership).mockResolvedValue({
          userId: "user-456",
          organizationId: "org-123",
          role: OrganizationUserRole.MEMBER,
          disabledAt: null,
          createdAt: nowInstant(),
          updatedAt: nowInstant(),
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

  describe("when listing members of an organization over a lapsed license's seats", () => {
    /** @scenario "Nobody loses their seat on the day a license lapses" */
    it("returns every member still active without ever consulting the seat license", async () => {
      const members = [
        { userId: "user-1", role: OrganizationUserRole.MEMBER, disabledAt: null },
        { userId: "user-2", role: OrganizationUserRole.MEMBER, disabledAt: null },
      ];
      vi.mocked(mockRepo.listAllMembers).mockResolvedValue({
        members: members as never,
        totalCount: members.length,
      });
      // Over-seats: a lapsed license for fewer members than the organization
      // already holds. A read must not consult this at all.
      mockCheckLimit.mockResolvedValue({ allowed: false });

      const result = await service.listMembers({ organizationId: "org-123" });

      expect(
        result.members.every((member) => (member as { disabledAt: null }).disabledAt === null),
      ).toBe(true);
      expect(mockCheckLimit).not.toHaveBeenCalled();
      expect(mockRepo.setMemberDisabled).not.toHaveBeenCalled();
    });
  });

  describe("updateTeamMemberRole()", () => {
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

/**
 * Unit tests for InviteService.
 *
 * Covers the @unit scenarios from specs/members/update-pending-invitation.feature:
 * - Pending invites query returns both PENDING and WAITING_APPROVAL invites
 * - createAdminInviteRecord creates record without sending email
 *
 * Tests the service in isolation with mocked dependencies.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrganizationUserRole, TeamUserRole } from "~/generated/prisma/client";
import type { PlanProvider } from "../../app-layer/subscription/plan-provider";
import { LimitExceededError } from "../../license-enforcement/errors";
import type { ILicenseEnforcementRepository } from "../../license-enforcement/license-enforcement.repository";
import {
  classifyInvitesByMemberType,
  InviteService,
  resolveInviteTeamMemberships,
} from "../invite.service";

const { mockSendInviteEmail } = vi.hoisted(() => ({
  mockSendInviteEmail: vi.fn(),
}));

// An invite's grants are ledger commands (ADR-092 delivery-plan PR 2).
const ledger = vi.hoisted(() => ({
  attachBindings: vi.fn(),
  revokeBindings: vi.fn(),
  revokeBindingsWhere: vi.fn(),
  defineRole: vi.fn(),
  deleteRole: vi.fn(),
}));
vi.mock("~/server/app-layer/authz/ledger", () => ({
  grantsLedgerWriter: () => ledger,
}));

vi.mock("../../mailer/inviteEmail", () => ({
  sendInviteEmail: (...args: unknown[]) => mockSendInviteEmail(...args),
}));

vi.mock("../../../env.mjs", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../env.mjs")>();
  return {
    ...original,
    env: {
      ...original.env,
      SENDGRID_API_KEY: "test-sendgrid-key",
    },
  };
});

describe("classifyInvitesByMemberType()", () => {
  describe("when invites have ADMIN role", () => {
    it("counts them as full members", () => {
      const invites = [{ role: OrganizationUserRole.ADMIN }];
      const customRoleMap = new Map();

      const result = classifyInvitesByMemberType(invites, customRoleMap);

      expect(result.fullMembers).toBe(1);
      expect(result.liteMembers).toBe(0);
    });
  });

  describe("when invites have MEMBER role", () => {
    it("counts them as full members", () => {
      const invites = [{ role: OrganizationUserRole.MEMBER }];
      const customRoleMap = new Map();

      const result = classifyInvitesByMemberType(invites, customRoleMap);

      expect(result.fullMembers).toBe(1);
      expect(result.liteMembers).toBe(0);
    });
  });

  describe("when invites have EXTERNAL role with no custom roles", () => {
    it("counts them as lite members", () => {
      const invites = [{ role: OrganizationUserRole.EXTERNAL, teams: [] }];
      const customRoleMap = new Map();

      const result = classifyInvitesByMemberType(invites, customRoleMap);

      expect(result.fullMembers).toBe(0);
      expect(result.liteMembers).toBe(1);
    });
  });

  describe("when invites have EXTERNAL role with view-only custom role", () => {
    it("counts them as lite members", () => {
      const invites = [
        {
          role: OrganizationUserRole.EXTERNAL,
          teams: [{ customRoleId: "role-1" }],
        },
      ];
      const customRoleMap = new Map([["role-1", ["traces:view"]]]);

      const result = classifyInvitesByMemberType(invites, customRoleMap);

      expect(result.fullMembers).toBe(0);
      expect(result.liteMembers).toBe(1);
    });
  });

  describe("when invites have EXTERNAL role with non-view custom role", () => {
    it("counts them as full members", () => {
      const invites = [
        {
          role: OrganizationUserRole.EXTERNAL,
          teams: [{ customRoleId: "role-1" }],
        },
      ];
      const customRoleMap = new Map([
        ["role-1", ["traces:view", "traces:manage"]],
      ]);

      const result = classifyInvitesByMemberType(invites, customRoleMap);

      expect(result.fullMembers).toBe(1);
      expect(result.liteMembers).toBe(0);
    });
  });

  describe("when invites have mixed roles", () => {
    it("counts each correctly", () => {
      const invites = [
        { role: OrganizationUserRole.ADMIN },
        { role: OrganizationUserRole.MEMBER },
        { role: OrganizationUserRole.EXTERNAL, teams: [] },
      ];
      const customRoleMap = new Map();

      const result = classifyInvitesByMemberType(invites, customRoleMap);

      expect(result.fullMembers).toBe(2);
      expect(result.liteMembers).toBe(1);
    });
  });
});

describe("InviteService", () => {
  let mockPrisma: any;
  let mockLicenseRepo: ILicenseEnforcementRepository;
  let mockPlanProvider: PlanProvider;
  let service: InviteService;

  beforeEach(() => {
    mockSendInviteEmail.mockClear();

    mockPrisma = {
      organizationInvite: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      organization: {
        findFirst: vi.fn(),
      },
      organizationUser: {
        findFirst: vi.fn(),
      },
      customRole: {
        findMany: vi.fn(),
      },
    };

    mockLicenseRepo = {
      getMemberCount: vi.fn(),
      getMembersLiteCount: vi.fn(),
    } as any;

    mockPlanProvider = {
      getActivePlan: vi.fn(),
    };

    service = new InviteService(mockPrisma, mockLicenseRepo, mockPlanProvider);
  });

  /**
   * Inviting an address that is already a member used to succeed, writing a
   * pending invite row beside the membership it duplicated — so the members
   * page showed the same person as both an ADMIN and freshly "Invited", and
   * whatever the admin was actually trying to do never happened.
   *
   * Asserted on `code`, not prose: the sentence a customer reads comes from the
   * presentation registry keyed by that code (ADR-045).
   */
  describe("createAdminInviteRecord()", () => {
    describe("when a Lite Member invitation carries team access above Viewer", () => {
      /** @scenario An invitation cannot carry team access above the invited seat */
      it("refuses it naming the seat rule", async () => {
        mockPrisma.organization.findFirst.mockResolvedValue({
          id: "org-1",
          name: "ACME",
        });

        await expect(
          service.createAdminInviteRecord({
            email: "new@example.com",
            role: OrganizationUserRole.EXTERNAL,
            organizationId: "org-1",
            teamIds: "team-1",
            teamAssignments: [{ teamId: "team-1", role: TeamUserRole.ADMIN }],
          }),
        ).rejects.toMatchObject({ code: "lite_member_viewer_only" });

        expect(mockPrisma.organizationInvite.create).not.toHaveBeenCalled();
      });

      /** @scenario An invitation cannot carry team access above the invited seat */
      it("refuses a custom role the same way", async () => {
        mockPrisma.organization.findFirst.mockResolvedValue({
          id: "org-1",
          name: "ACME",
        });

        await expect(
          service.createAdminInviteRecord({
            email: "new@example.com",
            role: OrganizationUserRole.EXTERNAL,
            organizationId: "org-1",
            teamIds: "team-1",
            teamAssignments: [
              {
                teamId: "team-1",
                role: TeamUserRole.CUSTOM,
                customRoleId: "role-1",
              },
            ],
          }),
        ).rejects.toMatchObject({ code: "lite_member_viewer_only" });
      });
    });

    describe("when a Lite Member invitation carries Viewer access", () => {
      it("lets it through", async () => {
        mockPrisma.organization.findFirst.mockResolvedValue({
          id: "org-1",
          name: "ACME",
        });
        mockPrisma.organizationInvite.create.mockResolvedValue({
          id: "invite-1",
        });

        await expect(
          service.createAdminInviteRecord({
            email: "new@example.com",
            role: OrganizationUserRole.EXTERNAL,
            organizationId: "org-1",
            teamIds: "team-1",
            teamAssignments: [{ teamId: "team-1", role: TeamUserRole.VIEWER }],
          }),
        ).resolves.toMatchObject({ invite: { id: "invite-1" } });
      });
    });
  });

  describe("resolveInviteTeamMemberships()", () => {
    describe("when a stored Lite Member invitation carries team access above Viewer", () => {
      /** @scenario An invitation cannot carry team access above the invited seat */
      it("corrects it to Viewer at acceptance", () => {
        // Invitations written before the seat ceiling may still promise more;
        // the seat corrects them the way a seat change corrects stored rows.
        expect(
          resolveInviteTeamMemberships({
            role: OrganizationUserRole.EXTERNAL,
            teamIds: "",
            teamAssignments: [
              {
                teamId: "team-1",
                role: TeamUserRole.ADMIN,
              },
              {
                teamId: "team-2",
                role: TeamUserRole.CUSTOM,
                customRoleId: "role-1",
              },
            ],
          }),
        ).toEqual([
          {
            teamId: "team-1",
            role: TeamUserRole.VIEWER,
            customRoleId: undefined,
          },
          {
            teamId: "team-2",
            role: TeamUserRole.VIEWER,
            customRoleId: undefined,
          },
        ]);
      });
    });

    describe("when a full seat invitation carries team assignments", () => {
      it("keeps them as stored", () => {
        expect(
          resolveInviteTeamMemberships({
            role: OrganizationUserRole.MEMBER,
            teamIds: "",
            teamAssignments: [
              {
                teamId: "team-1",
                role: TeamUserRole.CUSTOM,
                customRoleId: "role-1",
              },
            ],
          }),
        ).toEqual([
          {
            teamId: "team-1",
            role: TeamUserRole.CUSTOM,
            customRoleId: "role-1",
          },
        ]);
      });
    });

    describe("when the invitation carries only a team id list", () => {
      it("derives each team role from the seat", () => {
        expect(
          resolveInviteTeamMemberships({
            role: OrganizationUserRole.EXTERNAL,
            teamIds: "team-1, team-1, team-2",
            teamAssignments: null,
          }),
        ).toEqual([
          { teamId: "team-1", role: TeamUserRole.VIEWER },
          { teamId: "team-2", role: TeamUserRole.VIEWER },
        ]);
      });
    });
  });

  describe("assertNotAlreadyMembers()", () => {
    describe("when one of the addresses already belongs to a member", () => {
      /** @scenario "Inviting an existing member is refused with a reason" */
      it("refuses the batch and names the address", async () => {
        mockPrisma.organizationUser.findFirst.mockResolvedValue({
          user: { email: "already@example.com" },
        });

        await expect(
          service.assertNotAlreadyMembers({
            emails: ["new@example.com", "already@example.com"],
            organizationId: "org-1",
          }),
        ).rejects.toMatchObject({
          code: "already_organization_member",
          httpStatus: 409,
          fault: "customer",
          meta: { email: "already@example.com" },
        });
      });
    });

    describe("when none of the addresses belong to a member", () => {
      /** @scenario "Inviting a new address still succeeds" */
      it("lets the invites through", async () => {
        mockPrisma.organizationUser.findFirst.mockResolvedValue(null);

        await expect(
          service.assertNotAlreadyMembers({
            emails: ["new@example.com"],
            organizationId: "org-1",
          }),
        ).resolves.toBeUndefined();
      });
    });

    describe("when there is nothing to check", () => {
      it("does not query at all", async () => {
        await service.assertNotAlreadyMembers({
          emails: [],
          organizationId: "org-1",
        });

        expect(mockPrisma.organizationUser.findFirst).not.toHaveBeenCalled();
      });
    });
  });

  describe("checkDuplicateInvite()", () => {
    describe("when a PENDING invite exists for the email", () => {
      it("returns the existing invite", async () => {
        const existingInvite = { id: "inv-1", email: "test@example.com" };
        mockPrisma.organizationInvite.findFirst.mockResolvedValue(
          existingInvite,
        );

        const result = await service.checkDuplicateInvite({
          email: "test@example.com",
          organizationId: "org-1",
        });

        expect(result).toEqual(existingInvite);
      });
    });

    describe("when a WAITING_APPROVAL invite exists for the email", () => {
      it("returns the existing invite", async () => {
        const existingInvite = { id: "inv-2", email: "test@example.com" };
        mockPrisma.organizationInvite.findFirst.mockResolvedValue(
          existingInvite,
        );

        const result = await service.checkDuplicateInvite({
          email: "test@example.com",
          organizationId: "org-1",
        });

        expect(result).toEqual(existingInvite);
      });
    });

    describe("when no active invite exists", () => {
      it("returns null", async () => {
        mockPrisma.organizationInvite.findFirst.mockResolvedValue(null);

        const result = await service.checkDuplicateInvite({
          email: "test@example.com",
          organizationId: "org-1",
        });

        expect(result).toBeNull();
      });
    });
  });

  describe("checkLicenseLimits()", () => {
    beforeEach(() => {
      mockPrisma.customRole.findMany.mockResolvedValue([]);
    });

    describe("when member limit is exceeded", () => {
      it("throws LimitExceededError with members limitType", async () => {
        vi.mocked(mockLicenseRepo.getMemberCount).mockResolvedValue(10);
        vi.mocked(mockLicenseRepo.getMembersLiteCount).mockResolvedValue(0);
        vi.mocked(mockPlanProvider.getActivePlan).mockResolvedValue({
          maxMembers: 10,
          maxMembersLite: 100,
          overrideAddingLimitations: false,
        } as any);

        const error = await service
          .checkLicenseLimits({
            organizationId: "org-1",
            newInvites: [{ role: OrganizationUserRole.MEMBER }],
            user: { id: "user-1" } as any,
          })
          .catch((e) => e);

        expect(error).toBeInstanceOf(LimitExceededError);
        expect(error.limitType).toBe("members");
        expect(error.current).toBe(10);
        expect(error.max).toBe(10);
      });
    });

    describe("when lite member limit is exceeded", () => {
      it("throws LimitExceededError with membersLite limitType", async () => {
        vi.mocked(mockLicenseRepo.getMemberCount).mockResolvedValue(0);
        vi.mocked(mockLicenseRepo.getMembersLiteCount).mockResolvedValue(5);
        vi.mocked(mockPlanProvider.getActivePlan).mockResolvedValue({
          maxMembers: 100,
          maxMembersLite: 5,
          overrideAddingLimitations: false,
        } as any);

        const error = await service
          .checkLicenseLimits({
            organizationId: "org-1",
            newInvites: [{ role: OrganizationUserRole.EXTERNAL, teams: [] }],
            user: { id: "user-1" } as any,
          })
          .catch((e) => e);

        expect(error).toBeInstanceOf(LimitExceededError);
        expect(error.limitType).toBe("membersLite");
        expect(error.current).toBe(5);
        expect(error.max).toBe(5);
      });
    });

    describe("when limits are not exceeded", () => {
      it("forwards user to planProvider", async () => {
        vi.mocked(mockLicenseRepo.getMemberCount).mockResolvedValue(5);
        vi.mocked(mockLicenseRepo.getMembersLiteCount).mockResolvedValue(2);
        vi.mocked(mockPlanProvider.getActivePlan).mockResolvedValue({
          maxMembers: 100,
          maxMembersLite: 100,
          overrideAddingLimitations: false,
        } as any);

        await service.checkLicenseLimits({
          organizationId: "org-1",
          newInvites: [{ role: OrganizationUserRole.MEMBER }],
          user: { id: "user-1" } as any,
        });

        expect(mockPlanProvider.getActivePlan).toHaveBeenCalledWith({
          organizationId: "org-1",
          user: expect.objectContaining({ id: "user-1" }),
        });
      });

      it("does not throw", async () => {
        vi.mocked(mockLicenseRepo.getMemberCount).mockResolvedValue(5);
        vi.mocked(mockLicenseRepo.getMembersLiteCount).mockResolvedValue(2);
        vi.mocked(mockPlanProvider.getActivePlan).mockResolvedValue({
          maxMembers: 100,
          maxMembersLite: 100,
          overrideAddingLimitations: false,
        } as any);

        await expect(
          service.checkLicenseLimits({
            organizationId: "org-1",
            newInvites: [{ role: OrganizationUserRole.MEMBER }],
            user: { id: "user-1" } as any,
          }),
        ).resolves.not.toThrow();
      });
    });

    describe("when overrideAddingLimitations is true", () => {
      it("does not enforce limits", async () => {
        vi.mocked(mockLicenseRepo.getMemberCount).mockResolvedValue(1000);
        vi.mocked(mockLicenseRepo.getMembersLiteCount).mockResolvedValue(1000);
        vi.mocked(mockPlanProvider.getActivePlan).mockResolvedValue({
          maxMembers: 1,
          maxMembersLite: 1,
          overrideAddingLimitations: true,
        } as any);

        await expect(
          service.checkLicenseLimits({
            organizationId: "org-1",
            newInvites: [{ role: OrganizationUserRole.MEMBER }],
            user: { id: "user-1" } as any,
          }),
        ).resolves.not.toThrow();
      });
    });
  });

  describe("createAdminInviteRecord()", () => {
    describe("when organization exists", () => {
      const mockOrganization = { id: "org-1", name: "Test Org" };
      const mockInvite = {
        id: "inv-1",
        email: "user@example.com",
        inviteCode: "abc123",
        status: "PENDING",
      };

      beforeEach(() => {
        mockPrisma.organization.findFirst.mockResolvedValue(mockOrganization);
        mockPrisma.organizationInvite.create.mockResolvedValue(mockInvite);
      });

      it("creates a PENDING invite record", async () => {
        const result = await service.createAdminInviteRecord({
          email: "user@example.com",
          role: OrganizationUserRole.MEMBER,
          organizationId: "org-1",
          teamIds: "team-1",
        });

        expect(result.invite).toEqual(mockInvite);
        expect(mockPrisma.organizationInvite.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              email: "user@example.com",
              status: "PENDING",
            }),
          }),
        );
      });

      it("returns the organization for later email sending", async () => {
        const result = await service.createAdminInviteRecord({
          email: "user@example.com",
          role: OrganizationUserRole.MEMBER,
          organizationId: "org-1",
          teamIds: "team-1",
        });

        expect(result.organization).toEqual(mockOrganization);
      });

      it("does not send any email", async () => {
        await service.createAdminInviteRecord({
          email: "user@example.com",
          role: OrganizationUserRole.MEMBER,
          organizationId: "org-1",
          teamIds: "team-1",
        });

        expect(mockSendInviteEmail).not.toHaveBeenCalled();
      });
    });
  });

  describe("approveInvite()", () => {
    describe("when email service fails", () => {
      const mockOrganization = { id: "org-1", name: "Test Org" };
      const mockInvite = {
        id: "inv-1",
        email: "user@example.com",
        inviteCode: "abc123",
        status: "WAITING_APPROVAL",
        organization: mockOrganization,
      };
      const updatedInvite = {
        ...mockInvite,
        status: "PENDING",
        organization: undefined,
      };

      beforeEach(() => {
        mockPrisma.organizationInvite.findFirst.mockResolvedValue(mockInvite);
        mockPrisma.organizationInvite.update.mockResolvedValue(updatedInvite);
        mockSendInviteEmail.mockRejectedValue(new Error("SMTP failure"));
      });

      it("still approves the invitation", async () => {
        const result = await service.approveInvite({
          inviteId: "inv-1",
          organizationId: "org-1",
        });

        expect(result.invite.status).toBe("PENDING");
      });

      it("returns emailNotSent as true", async () => {
        const result = await service.approveInvite({
          inviteId: "inv-1",
          organizationId: "org-1",
        });

        expect(result.emailNotSent).toBe(true);
      });
    });
  });

  describe("createPaymentPendingInvite()", () => {
    describe("when creating a payment-pending invite", () => {
      const mockInvite = {
        id: "inv-pp-1",
        email: "new@example.com",
        inviteCode: "xyz789",
        status: "PAYMENT_PENDING",
        subscriptionId: "sub-1",
      };

      beforeEach(() => {
        mockPrisma.organizationInvite.create.mockResolvedValue(mockInvite);
      });

      it("creates an invite with PAYMENT_PENDING status", async () => {
        await service.createPaymentPendingInvite({
          email: "new@example.com",
          role: OrganizationUserRole.MEMBER,
          organizationId: "org-1",
          teamIds: "team-1",
          subscriptionId: "sub-1",
        });

        expect(mockPrisma.organizationInvite.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              email: "new@example.com",
              status: "PAYMENT_PENDING",
              subscriptionId: "sub-1",
              expiration: null,
            }),
          }),
        );
      });

      it("does not send any email", async () => {
        await service.createPaymentPendingInvite({
          email: "new@example.com",
          role: OrganizationUserRole.MEMBER,
          organizationId: "org-1",
          teamIds: "team-1",
          subscriptionId: "sub-1",
        });

        expect(mockSendInviteEmail).not.toHaveBeenCalled();
      });

      it("returns the created invite", async () => {
        const result = await service.createPaymentPendingInvite({
          email: "new@example.com",
          role: OrganizationUserRole.MEMBER,
          organizationId: "org-1",
          teamIds: "team-1",
          subscriptionId: "sub-1",
        });

        expect(result).toEqual(mockInvite);
      });
    });
  });

  describe("approvePaymentPendingInvites()", () => {
    const mockOrganization = { id: "org-1", name: "Test Org" };

    describe("when there are PAYMENT_PENDING invites for a subscription", () => {
      const pendingInvites = [
        {
          id: "inv-1",
          email: "alice@example.com",
          inviteCode: "code1",
          status: "PAYMENT_PENDING",
          subscriptionId: "sub-1",
          organization: mockOrganization,
        },
        {
          id: "inv-2",
          email: "bob@example.com",
          inviteCode: "code2",
          status: "PAYMENT_PENDING",
          subscriptionId: "sub-1",
          organization: mockOrganization,
        },
      ];

      beforeEach(() => {
        mockPrisma.organizationInvite.findMany.mockResolvedValue(
          pendingInvites,
        );
        mockPrisma.organizationInvite.update.mockImplementation(
          ({ where }: { where: { id: string } }) => {
            const invite = pendingInvites.find((i) => i.id === where.id);
            return Promise.resolve({ ...invite, status: "PENDING" });
          },
        );
        mockSendInviteEmail.mockResolvedValue(undefined);
      });

      it("transitions all invites to PENDING", async () => {
        const result = await service.approvePaymentPendingInvites({
          subscriptionId: "sub-1",
          organizationId: "org-1",
        });

        expect(result).toHaveLength(2);
        expect(result[0]!.status).toBe("PENDING");
        expect(result[1]!.status).toBe("PENDING");
      });

      it("sets 48-hour expiration on each invite", async () => {
        await service.approvePaymentPendingInvites({
          subscriptionId: "sub-1",
          organizationId: "org-1",
        });

        expect(mockPrisma.organizationInvite.update).toHaveBeenCalledTimes(2);
        const firstCall =
          mockPrisma.organizationInvite.update.mock.calls[0]![0];
        expect(firstCall.data.expiration).toBeInstanceOf(Date);
      });

      it("sends invite emails for each invite", async () => {
        await service.approvePaymentPendingInvites({
          subscriptionId: "sub-1",
          organizationId: "org-1",
        });

        expect(mockSendInviteEmail).toHaveBeenCalledTimes(2);
        expect(mockSendInviteEmail).toHaveBeenCalledWith(
          expect.objectContaining({ email: "alice@example.com" }),
        );
        expect(mockSendInviteEmail).toHaveBeenCalledWith(
          expect.objectContaining({ email: "bob@example.com" }),
        );
      });
    });

    describe("when there are no PAYMENT_PENDING invites", () => {
      beforeEach(() => {
        mockPrisma.organizationInvite.findMany.mockResolvedValue([]);
      });

      it("returns an empty array", async () => {
        const result = await service.approvePaymentPendingInvites({
          subscriptionId: "sub-1",
          organizationId: "org-1",
        });

        expect(result).toEqual([]);
      });
    });
  });

  describe("subscription invite flow: create → approve → apply", () => {
    describe("when a PAYMENT_PENDING invite is approved and then applied", () => {
      const mockOrganization = { id: "org-1", name: "Test Org" };
      let roleBindingsCreated: Array<Record<string, unknown>>;

      beforeEach(() => {
        roleBindingsCreated = [];

        // Step 1: createPaymentPendingInvite creates a PAYMENT_PENDING record
        mockPrisma.organizationInvite.create.mockResolvedValue({
          id: "inv-flow-1",
          email: "sub-user@example.com",
          inviteCode: "flow-code-1",
          status: "PAYMENT_PENDING",
          subscriptionId: "sub-flow-1",
          organizationId: "org-1",
          teamIds: "team-1",
          teamAssignments: null,
          role: "MEMBER",
          expiration: null,
        });

        // Step 2: approvePaymentPendingInvites finds the invite and transitions it
        mockPrisma.organizationInvite.findMany.mockResolvedValue([
          {
            id: "inv-flow-1",
            email: "sub-user@example.com",
            inviteCode: "flow-code-1",
            status: "PAYMENT_PENDING",
            subscriptionId: "sub-flow-1",
            organizationId: "org-1",
            organization: mockOrganization,
          },
        ]);
        mockPrisma.organizationInvite.update.mockResolvedValue({
          id: "inv-flow-1",
          email: "sub-user@example.com",
          inviteCode: "flow-code-1",
          status: "PENDING",
          subscriptionId: "sub-flow-1",
          organizationId: "org-1",
          teamIds: "team-1",
          teamAssignments: null,
          role: "MEMBER",
          expiration: new Date(Date.now() + 48 * 60 * 60 * 1000),
        });
        mockSendInviteEmail.mockResolvedValue(undefined);

        // Step 3: applyInvite — the grants it carries are ledger commands
        // now, so the attach is where they can be observed.
        (mockPrisma as any).organizationUser = {
          createMany: vi.fn(),
        };
        ledger.revokeBindingsWhere.mockResolvedValue(0);
        ledger.attachBindings.mockImplementation(
          ({ bindings }: { bindings: Array<Record<string, unknown>> }) => {
            roleBindingsCreated.push(...bindings);
            return Promise.resolve({ attached: [], duplicates: [] });
          },
        );
      });

      it("transitions through PAYMENT_PENDING → PENDING → ACCEPTED and attaches the grants", async () => {
        // Step 1: Create PAYMENT_PENDING invite
        const invite = await service.createPaymentPendingInvite({
          email: "sub-user@example.com",
          role: "MEMBER" as any,
          organizationId: "org-1",
          teamIds: "team-1",
          subscriptionId: "sub-flow-1",
        });

        expect(invite.status).toBe("PAYMENT_PENDING");

        // Step 2: Simulate webhook approval
        const approved = await service.approvePaymentPendingInvites({
          subscriptionId: "sub-flow-1",
          organizationId: "org-1",
        });

        expect(approved).toHaveLength(1);
        expect(approved[0]!.status).toBe("PENDING");

        // Step 3: Apply the now-PENDING invite (simulating acceptInvite)
        await service.applyInvite({
          userId: "user-flow-1",
          invite: approved[0]! as any,
        });

        // Verify: org-scoped grant was attached (MEMBER gets one)
        const orgBinding = roleBindingsCreated.find(
          (rb) => rb.scopeType === "ORGANIZATION",
        );
        expect(orgBinding).toBeDefined();
        expect(orgBinding!.principal).toEqual({ userId: "user-flow-1" });

        // Verify: team-scoped grant was attached
        const teamBinding = roleBindingsCreated.find(
          (rb) => rb.scopeType === "TEAM",
        );
        expect(teamBinding).toBeDefined();
        expect(teamBinding!.principal).toEqual({ userId: "user-flow-1" });
        expect(teamBinding!.scopeId).toBe("team-1");

        // Verify: invite was marked ACCEPTED
        expect(mockPrisma.organizationInvite.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: { status: "ACCEPTED" },
          }),
        );
      });
    });
  });

  describe("applyInvite", () => {
    describe("when invite status is not PENDING", () => {
      it("throws for PAYMENT_PENDING invites", async () => {
        await expect(
          service.applyInvite({
            userId: "user-1",
            invite: {
              id: "inv-guard-1",
              status: "PAYMENT_PENDING",
              organizationId: "org-1",
              teamIds: "team-1",
              teamAssignments: null,
              role: "MEMBER",
            } as any,
          }),
        ).rejects.toThrow(
          "Cannot apply invite inv-guard-1: status is PAYMENT_PENDING, expected PENDING",
        );
      });

      it("throws for ACCEPTED invites", async () => {
        await expect(
          service.applyInvite({
            userId: "user-1",
            invite: {
              id: "inv-guard-2",
              status: "ACCEPTED",
              organizationId: "org-1",
              teamIds: "team-1",
              teamAssignments: null,
              role: "MEMBER",
            } as any,
          }),
        ).rejects.toThrow(
          "Cannot apply invite inv-guard-2: status is ACCEPTED, expected PENDING",
        );
      });
    });
  });
});

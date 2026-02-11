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
import { OrganizationUserRole } from "@prisma/client";
import {
  classifyInvitesByMemberType,
  InviteService,
  type ISubscriptionHandler,
} from "../invite.service";
import type { ILicenseEnforcementRepository } from "../../license-enforcement/license-enforcement.repository";
import { LicenseLimitError } from "../errors";
import { LICENSE_LIMIT_ERRORS } from "../../license-enforcement/license-limit-guard";

const { mockSendInviteEmail } = vi.hoisted(() => ({
  mockSendInviteEmail: vi.fn(),
}));

vi.mock("../../mailer/inviteEmail", () => ({
  sendInviteEmail: (...args: unknown[]) => mockSendInviteEmail(...args),
}));

vi.mock("../../../env.mjs", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../../env.mjs")>();
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
  let mockSubscriptionHandler: ISubscriptionHandler;
  let service: InviteService;

  beforeEach(() => {
    mockSendInviteEmail.mockClear();

    mockPrisma = {
      organizationInvite: {
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      organization: {
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

    mockSubscriptionHandler = {
      getActivePlan: vi.fn(),
    };

    service = new InviteService(
      mockPrisma,
      mockLicenseRepo,
      mockSubscriptionHandler
    );
  });

  describe("checkDuplicateInvite()", () => {
    describe("when a PENDING invite exists for the email", () => {
      it("returns the existing invite", async () => {
        const existingInvite = { id: "inv-1", email: "test@example.com" };
        mockPrisma.organizationInvite.findFirst.mockResolvedValue(
          existingInvite
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
          existingInvite
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
      it("throws LicenseLimitError", async () => {
        vi.mocked(mockLicenseRepo.getMemberCount).mockResolvedValue(10);
        vi.mocked(mockLicenseRepo.getMembersLiteCount).mockResolvedValue(0);
        vi.mocked(mockSubscriptionHandler.getActivePlan).mockResolvedValue({
          maxMembers: 10,
          maxMembersLite: 100,
          overrideAddingLimitations: false,
        } as any);

        await expect(
          service.checkLicenseLimits({
            organizationId: "org-1",
            newInvites: [{ role: OrganizationUserRole.MEMBER }],
            user: { id: "user-1" } as any,
          })
        ).rejects.toThrow(LicenseLimitError);

        await expect(
          service.checkLicenseLimits({
            organizationId: "org-1",
            newInvites: [{ role: OrganizationUserRole.MEMBER }],
            user: { id: "user-1" } as any,
          })
        ).rejects.toThrow(LICENSE_LIMIT_ERRORS.FULL_MEMBER_LIMIT);
      });
    });

    describe("when lite member limit is exceeded", () => {
      it("throws LicenseLimitError", async () => {
        vi.mocked(mockLicenseRepo.getMemberCount).mockResolvedValue(0);
        vi.mocked(mockLicenseRepo.getMembersLiteCount).mockResolvedValue(5);
        vi.mocked(mockSubscriptionHandler.getActivePlan).mockResolvedValue({
          maxMembers: 100,
          maxMembersLite: 5,
          overrideAddingLimitations: false,
        } as any);

        await expect(
          service.checkLicenseLimits({
            organizationId: "org-1",
            newInvites: [{ role: OrganizationUserRole.EXTERNAL, teams: [] }],
            user: { id: "user-1" } as any,
          })
        ).rejects.toThrow(LicenseLimitError);

        await expect(
          service.checkLicenseLimits({
            organizationId: "org-1",
            newInvites: [{ role: OrganizationUserRole.EXTERNAL, teams: [] }],
            user: { id: "user-1" } as any,
          })
        ).rejects.toThrow(LICENSE_LIMIT_ERRORS.MEMBER_LITE_LIMIT);
      });
    });

    describe("when limits are not exceeded", () => {
      it("does not throw", async () => {
        vi.mocked(mockLicenseRepo.getMemberCount).mockResolvedValue(5);
        vi.mocked(mockLicenseRepo.getMembersLiteCount).mockResolvedValue(2);
        vi.mocked(mockSubscriptionHandler.getActivePlan).mockResolvedValue({
          maxMembers: 100,
          maxMembersLite: 100,
          overrideAddingLimitations: false,
        } as any);

        await expect(
          service.checkLicenseLimits({
            organizationId: "org-1",
            newInvites: [{ role: OrganizationUserRole.MEMBER }],
            user: { id: "user-1" } as any,
          })
        ).resolves.not.toThrow();
      });
    });

    describe("when overrideAddingLimitations is true", () => {
      it("does not enforce limits", async () => {
        vi.mocked(mockLicenseRepo.getMemberCount).mockResolvedValue(1000);
        vi.mocked(mockLicenseRepo.getMembersLiteCount).mockResolvedValue(1000);
        vi.mocked(mockSubscriptionHandler.getActivePlan).mockResolvedValue({
          maxMembers: 1,
          maxMembersLite: 1,
          overrideAddingLimitations: true,
        } as any);

        await expect(
          service.checkLicenseLimits({
            organizationId: "org-1",
            newInvites: [{ role: OrganizationUserRole.MEMBER }],
            user: { id: "user-1" } as any,
          })
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
          })
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
});

// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The membership row an SSO-admitted arrival gets, on the seat the
 * organization hands to people who join without an invitation (ADR-143).
 *
 * Spec: specs/members/developer-seat.feature
 */
import { describe, expect, it, vi } from "vitest";
import { OrganizationUserRole, Prisma } from "~/generated/prisma/client";
import { PrismaSsoMembershipRepository } from "../sso-membership.prisma.repository";

function fakePrisma({
  joinerRole,
  existingRole = null,
}: {
  joinerRole: OrganizationUserRole;
  /** A row already there, which makes the create collide. */
  existingRole?: OrganizationUserRole | null;
}) {
  const organizationUser = {
    create: vi.fn(async () => {
      if (existingRole) {
        throw new Prisma.PrismaClientKnownRequestError("duplicate", {
          code: "P2002",
          clientVersion: "test",
        });
      }
      return {};
    }),
    findUnique: vi.fn(async () =>
      existingRole ? { role: existingRole } : null,
    ),
  };
  const auditLog = { create: vi.fn(async () => ({})) };
  return {
    organization: { findUnique: vi.fn(async () => ({ joinerRole })) },
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) =>
      callback({ organizationUser, auditLog }),
    ),
    organizationUser,
    auditLog,
  };
}

describe("given an organization whose joiner seat is Developer", () => {
  describe("when a person is admitted through single sign-on", () => {
    /** @scenario The joiner seat setting lands SSO joiners as Developers */
    it("writes a Developer row with no organization-wide grant pending", async () => {
      const prisma = fakePrisma({ joinerRole: OrganizationUserRole.DEVELOPER });
      const repository = new PrismaSsoMembershipRepository(prisma as never);

      await expect(
        repository.createMembership({
          userId: "user_sam",
          organizationId: "org_acme",
        }),
      ).resolves.toEqual({ outcome: "created", seat: "DEVELOPER" });

      expect(prisma.organizationUser.create).toHaveBeenCalledWith({
        data: {
          userId: "user_sam",
          organizationId: "org_acme",
          role: OrganizationUserRole.DEVELOPER,
          pendingSsoGrantId: null,
        },
      });
    });

    it("audits the admission itself, since no grant will", async () => {
      const prisma = fakePrisma({ joinerRole: OrganizationUserRole.DEVELOPER });
      const repository = new PrismaSsoMembershipRepository(prisma as never);

      await repository.createMembership({
        userId: "user_sam",
        organizationId: "org_acme",
      });

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          action: "organization.member.admitted",
          userId: "user_sam",
          organizationId: "org_acme",
          metadata: { seat: "DEVELOPER", via: "sso" },
        },
      });
    });
  });
});

describe("given a Developer-joiner organization where a Full member's row already exists", () => {
  describe("when a concurrent sign-in tries to create the row again", () => {
    it("answers the seat the existing row holds, not the setting", async () => {
      const prisma = fakePrisma({
        joinerRole: OrganizationUserRole.DEVELOPER,
        existingRole: OrganizationUserRole.MEMBER,
      });
      const repository = new PrismaSsoMembershipRepository(prisma as never);

      await expect(
        repository.createMembership({
          userId: "user_sam",
          organizationId: "org_acme",
        }),
      ).resolves.toEqual({ outcome: "already-present", seat: "MEMBER" });
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });
  });
});

describe("given an organization that never changed the setting", () => {
  describe("when a person is admitted through single sign-on", () => {
    /** @scenario The joiner seat setting is Full by default */
    it("writes a Full member row with the organization-wide grant pending", async () => {
      const prisma = fakePrisma({ joinerRole: OrganizationUserRole.MEMBER });
      const repository = new PrismaSsoMembershipRepository(prisma as never);

      await expect(
        repository.createMembership({
          userId: "user_sam",
          organizationId: "org_acme",
        }),
      ).resolves.toEqual({ outcome: "created", seat: "MEMBER" });

      expect(prisma.organizationUser.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          role: OrganizationUserRole.MEMBER,
          pendingSsoGrantId: expect.stringMatching(/^rolebinding_/),
        }),
      });
      // The grant attached next is this admission's audit entry.
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });
  });
});

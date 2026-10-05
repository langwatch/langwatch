/**
 * The membership row an arrival without an invitation gets, on the seat the
 * organization hands to joiners (ADR-171). Spec: specs/members/developer-seat.feature
 */

import type { AuthzGrantsService } from "@langwatch/authz-contract";
import { Prisma } from "@langwatch/prisma-client/generated";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it, vi } from "vitest";

import { PrismaOrganizationMembershipRepository } from "../prisma/prisma.organization-membership.repository.ts";

type Seat = "MEMBER" | "DEVELOPER";

function harness({ joinerRole, existingRole }: { joinerRole: Seat; existingRole?: Seat }) {
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
    findUnique: vi.fn(async () => (existingRole ? { role: existingRole } : null)),
  };
  const auditLog = { create: vi.fn(async () => ({})) };
  const transactionClient = prismaDouble({ organizationUser, auditLog });
  const prisma = prismaDouble({
    organization: { findUnique: vi.fn(async () => ({ joinerRole })) },
    organizationUser,
    auditLog,
    $transaction: (run) => run(transactionClient),
  });
  const repository = PrismaOrganizationMembershipRepository.create({
    database: prisma,
    grants: createApiFixture<AuthzGrantsService>(),
  });
  return { repository, organizationUser, auditLog };
}

const ARRIVAL = {
  organizationId: "org_acme",
  userId: "user_sam",
  pendingAdmissionId: "rolebinding_1",
  admission: { via: "sso" },
} as const;

describe("given an organization whose joiner seat is Developer", () => {
  describe("when a person is admitted through single sign-on", () => {
    /** @scenario The joiner seat setting lands SSO joiners as Developers */
    it("writes a Developer row with no organization-wide grant pending", async () => {
      const { repository, organizationUser } = harness({ joinerRole: "DEVELOPER" });

      await expect(repository.createMembership(ARRIVAL)).resolves.toEqual({
        outcome: "created",
        seat: "DEVELOPER",
      });

      expect(organizationUser.create).toHaveBeenCalledWith({
        data: {
          userId: "user_sam",
          organizationId: "org_acme",
          role: "DEVELOPER",
          pendingSsoGrantId: null,
        },
      });
    });

    it("audits the admission itself, since no grant will", async () => {
      const { repository, auditLog } = harness({ joinerRole: "DEVELOPER" });

      await repository.createMembership(ARRIVAL);

      expect(auditLog.create).toHaveBeenCalledWith({
        data: {
          action: "organization.member.admitted",
          userId: "user_sam",
          actorUserId: null,
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
      const { repository, auditLog } = harness({
        joinerRole: "DEVELOPER",
        existingRole: "MEMBER",
      });

      await expect(repository.createMembership(ARRIVAL)).resolves.toEqual({
        outcome: "already-present",
        seat: "MEMBER",
      });
      expect(auditLog.create).not.toHaveBeenCalled();
    });
  });
});

describe("given an organization that never changed the setting", () => {
  describe("when a person is admitted through single sign-on", () => {
    /** @scenario The joiner seat setting is Full by default */
    it("writes a Full member row with the organization-wide grant pending", async () => {
      const { repository, organizationUser, auditLog } = harness({ joinerRole: "MEMBER" });

      await expect(repository.createMembership(ARRIVAL)).resolves.toEqual({
        outcome: "created",
        seat: "MEMBER",
      });

      expect(organizationUser.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ role: "MEMBER", pendingSsoGrantId: "rolebinding_1" }),
      });
      // The grant attached next is this admission's audit entry.
      expect(auditLog.create).not.toHaveBeenCalled();
    });
  });
});

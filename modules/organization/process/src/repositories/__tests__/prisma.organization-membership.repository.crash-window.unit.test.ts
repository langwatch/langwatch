/** Crash window between Prisma write and ledger append: removal and demotion converge on retry. */

import type { AuthzGrantsService } from "@langwatch/authz-contract";
import { OrganizationUserRole } from "@langwatch/prisma-client/generated";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PrismaOrganizationMembershipRepository } from "../prisma/prisma.organization-membership.repository.ts";

const memberFindUnique = vi.fn();
const memberCount = vi.fn();
const memberDelete = vi.fn();
const memberUpdate = vi.fn();
const memberUpdateMany = vi.fn();
const teamFindMany = vi.fn();
const teamUpdateMany = vi.fn();
const projectUpdateMany = vi.fn();
const roleBindingFindMany = vi.fn();
const queryRaw = vi.fn();

const transactionScript = {
  organizationUser: {
    findUnique: memberFindUnique,
    count: memberCount,
    delete: memberDelete,
    update: memberUpdate,
    updateMany: memberUpdateMany,
  },
  team: { findMany: teamFindMany, updateMany: teamUpdateMany },
  project: { updateMany: projectUpdateMany },
  roleBinding: { findMany: roleBindingFindMany },
  $queryRaw: queryRaw,
};

const transactionClient = prismaDouble(transactionScript);

const prisma = prismaDouble({
  ...transactionScript,
  $transaction: (run) => run(transactionClient),
});

const attachBindings = vi.fn();
const changeBindingRole = vi.fn();
const revokeBindings = vi.fn();
const revokeBindingsWhere = vi.fn();

const writer = createApiFixture<AuthzGrantsService>({
  attachBindings,
  changeBindingRole,
  revokeBindings,
  revokeBindingsWhere,
});

let repository: PrismaOrganizationMembershipRepository;

beforeEach(() => {
  vi.clearAllMocks();
  memberCount.mockResolvedValue(2);
  memberDelete.mockResolvedValue(undefined);
  memberUpdate.mockResolvedValue(undefined);
  memberUpdateMany.mockResolvedValue({ count: 1 });
  teamFindMany.mockResolvedValue([]);
  teamUpdateMany.mockResolvedValue({ count: 0 });
  projectUpdateMany.mockResolvedValue({ count: 0 });
  roleBindingFindMany.mockResolvedValue([]);
  queryRaw.mockResolvedValue([{ userId: "user_a" }, { userId: "user_b" }]);
  attachBindings.mockResolvedValue({ attached: [], duplicates: [] });
  changeBindingRole.mockResolvedValue(undefined);
  revokeBindings.mockResolvedValue(undefined);
  revokeBindingsWhere.mockResolvedValue(0);
  repository = PrismaOrganizationMembershipRepository.create({
    database: prisma,
    grants: writer,
    cipher: { encrypt: (value: string) => value, decrypt: (value: string) => value },
  });
});

describe("given a member whose removal is under way", () => {
  describe("when the removal completes", () => {
    /** @scenario "Removing a member retires their cached grants after the seat is gone" */
    it("deletes the membership row before revoking the grants, so the epoch bump comes last", async () => {
      const order: string[] = [];
      memberFindUnique.mockResolvedValue({
        role: OrganizationUserRole.MEMBER,
        disabledAt: null,
      });
      memberDelete.mockImplementation(async () => {
        order.push("deleteMembership");
      });
      revokeBindingsWhere.mockImplementation(async () => {
        order.push("revokeGrants");
        return 1;
      });

      await repository.deleteMember({
        organizationId: "org_1",
        userId: "user_a",
        actingUserId: "user_b",
      });

      expect(order).toEqual(["deleteMembership", "revokeGrants"]);
    });
  });

  describe("when the grants revocation fails after the seat is gone", () => {
    it("surfaces the failure, and a retry revokes what the vanished seat left behind", async () => {
      memberFindUnique.mockResolvedValue({
        role: OrganizationUserRole.MEMBER,
        disabledAt: null,
      });
      revokeBindingsWhere.mockRejectedValueOnce(new Error("ledger unavailable"));

      await expect(
        repository.deleteMember({
          organizationId: "org_1",
          userId: "user_a",
          actingUserId: "user_b",
        }),
      ).rejects.toThrow("ledger unavailable");
      expect(memberDelete).toHaveBeenCalled();

      memberFindUnique.mockResolvedValue(null);
      await expect(
        repository.deleteMember({
          organizationId: "org_1",
          userId: "user_a",
          actingUserId: "user_b",
        }),
      ).rejects.toMatchObject({ code: "member_not_found" });
      expect(revokeBindingsWhere).toHaveBeenCalledTimes(2);
    });
  });

  describe("when the membership row is already gone", () => {
    it("revokes the grants the vanished seat left behind before refusing", async () => {
      memberFindUnique.mockResolvedValue(null);

      await expect(
        repository.deleteMember({
          organizationId: "org_1",
          userId: "user_a",
          actingUserId: "user_b",
        }),
      ).rejects.toMatchObject({ code: "member_not_found" });

      expect(revokeBindingsWhere).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org_1",
          where: { userId: "user_a" },
        }),
      );
    });
  });

  describe("when the member is the last active admin", () => {
    /** @scenario "Removing the last active admin is refused" */
    it("refuses without revoking anything", async () => {
      memberFindUnique.mockResolvedValue({
        role: OrganizationUserRole.ADMIN,
        disabledAt: null,
      });
      memberCount.mockResolvedValue(1);

      await expect(
        repository.deleteMember({
          organizationId: "org_1",
          userId: "user_a",
          actingUserId: "user_b",
        }),
      ).rejects.toMatchObject({ code: "cannot_remove_last_admin" });

      expect(revokeBindingsWhere).not.toHaveBeenCalled();
      expect(memberDelete).not.toHaveBeenCalled();
    });
  });

  describe("when the transaction's locked re-check refuses a removal the advisory pre-check let through", () => {
    /** @scenario "Two admins removed at the same time cannot both succeed" */
    it("refuses before revoking anything, so the survivor keeps their access", async () => {
      memberFindUnique.mockResolvedValue({
        role: OrganizationUserRole.ADMIN,
        disabledAt: null,
      });
      // The unlocked pre-check outside the transaction sees two admins...
      memberCount.mockResolvedValue(2);
      // ...but a concurrent removal of the other admin committed before this locked read.
      queryRaw.mockResolvedValue([{ userId: "user_a" }]);

      await expect(
        repository.deleteMember({
          organizationId: "org_1",
          userId: "user_a",
          actingUserId: "user_b",
        }),
      ).rejects.toMatchObject({ code: "cannot_remove_last_admin" });

      expect(memberDelete).not.toHaveBeenCalled();
      expect(revokeBindingsWhere).not.toHaveBeenCalled();
    });
  });
});

describe("given an admin being demoted to member", () => {
  describe("when the binding correction fails after the seat has committed", () => {
    it("puts the seat back, so no ADMIN binding is left under a MEMBER seat", async () => {
      memberFindUnique.mockResolvedValue({
        userId: "user_a",
        organizationId: "org_1",
        role: OrganizationUserRole.ADMIN,
      });
      roleBindingFindMany.mockResolvedValue([{ id: "binding_1" }]);
      changeBindingRole.mockRejectedValue(new Error("ledger unavailable"));

      await expect(
        repository.updateMemberRole({
          caller: { type: "system" },
          organizationId: "org_1",
          userId: "user_a",
          role: OrganizationUserRole.MEMBER,
          effectiveTeamRoleUpdates: [],
          currentUserId: "user_b",
        }),
      ).rejects.toThrow("ledger unavailable");

      expect(memberUpdateMany).toHaveBeenCalledWith({
        where: {
          organizationId: "org_1",
          userId: "user_a",
          role: OrganizationUserRole.MEMBER,
        },
        data: { role: OrganizationUserRole.ADMIN },
      });
    });
  });
});

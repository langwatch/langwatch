/**
 * The two membership writes that straddle a grants-ledger append, seen from
 * the crash window between them.
 *
 * A ledger command cannot join a Prisma transaction, so both `deleteMember`
 * and `updateMemberRole` write twice with a gap in the middle. These tests
 * kill the ledger inside that gap and assert the end state is the fail-safe
 * one: the member keeps their old access, never a seat and a grant that
 * disagree in the direction of more access.
 */

import type { AuthzGrantsService } from "@langwatch/authz-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  OrganizationUserRole,
  type Prisma,
  type PrismaClient,
} from "@langwatch/prisma-client/generated";
import { PrismaOrganizationMembershipRepository } from "../prisma/prisma.organization-membership.repository";

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

const transactionClient = {
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
} as unknown as Prisma.TransactionClient;

const prisma = {
  ...transactionClient,
  $transaction: (
    run: (tx: Prisma.TransactionClient) => Promise<unknown>,
  ): Promise<unknown> => run(transactionClient),
} as unknown as PrismaClient;

const attachBindings = vi.fn();
const changeBindingRole = vi.fn();
const revokeBindings = vi.fn();
const revokeBindingsWhere = vi.fn();

const writer = {
  attachBindings,
  changeBindingRole,
  revokeBindings,
  revokeBindingsWhere,
} as unknown as AuthzGrantsService;

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
  repository = PrismaOrganizationMembershipRepository.create({ database: prisma, grants: writer });
});

describe("given a member whose removal is under way", () => {
  describe("when the grants revocation fails", () => {
    it("keeps the membership row, so the seat outlives the grants and not the other way round", async () => {
      memberFindUnique.mockResolvedValue({
        role: OrganizationUserRole.MEMBER,
        disabledAt: null,
      });
      revokeBindingsWhere.mockRejectedValue(new Error("ledger unavailable"));

      await expect(
        repository.deleteMember({
          organizationId: "org_1",
          userId: "user_a",
          actingUserId: "user_b",
        }),
      ).rejects.toThrow("ledger unavailable");

      expect(memberDelete).not.toHaveBeenCalled();
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
    it("puts back the grants it just revoked, so the survivor keeps their access", async () => {
      memberFindUnique.mockResolvedValue({
        role: OrganizationUserRole.ADMIN,
        disabledAt: null,
      });
      // The unlocked pre-check outside the transaction sees two admins...
      memberCount.mockResolvedValue(2);
      // ...but a concurrent removal of the organization's other admin has
      // already committed by the time this one takes its locked read.
      queryRaw.mockResolvedValue([{ userId: "user_a" }]);
      roleBindingFindMany.mockResolvedValue([
        {
          id: "rb_1",
          role: "ADMIN",
          customRoleId: null,
          scopeType: "ORGANIZATION",
          scopeId: "org_1",
        },
      ]);

      await expect(
        repository.deleteMember({
          organizationId: "org_1",
          userId: "user_a",
          actingUserId: "user_b",
        }),
      ).rejects.toMatchObject({ code: "cannot_remove_last_admin" });

      expect(memberDelete).not.toHaveBeenCalled();
      expect(attachBindings).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org_1",
          bindings: [
            expect.objectContaining({
              bindingId: "rb_1",
              principal: { userId: "user_a" },
              role: "ADMIN",
              customRoleId: null,
              scopeType: "ORGANIZATION",
              scopeId: "org_1",
            }),
          ],
          onDuplicate: "skip",
        }),
      );
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

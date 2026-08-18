/**
 * The team removal's write shape, at the seam where its last-admin invariant
 * is actually decided.
 *
 * Two removals aimed at a team's last two admins have to conflict, or both
 * commit and the team is left with nobody. Whether Postgres refuses the
 * second is a property of two live transactions and is pinned by
 * `team.service.last-admin-concurrency.integration.test.ts`. What is pinned
 * here is the thing that makes the refusal possible at all: the transaction
 * writes a row both removals touch. It used to be the binding rows it
 * deleted; those are ledger facts now and cannot be deleted in here, so the
 * team row carries the conflict, and a removal that stops writing it silently
 * takes the invariant with it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type Prisma,
  type PrismaClient,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import type { GrantsLedgerWriter } from "~/server/app-layer/authz/ledger";
import { TeamService } from "../team.service";

const revokeBindings = vi.fn();

const teamFindUnique = vi.fn();
const teamUpdate = vi.fn();
const bindingFindMany = vi.fn();
const bindingFindFirst = vi.fn();
const groupMembershipFindMany = vi.fn();
const teamUserDeleteMany = vi.fn();

const transactionClient = {
  team: { findUnique: teamFindUnique, update: teamUpdate },
  roleBinding: { findMany: bindingFindMany, findFirst: bindingFindFirst },
  groupMembership: { findMany: groupMembershipFindMany },
  teamUser: { deleteMany: teamUserDeleteMany },
} as unknown as Prisma.TransactionClient;

const prisma = {
  ...transactionClient,
  $transaction: (run: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
    run(transactionClient),
} as unknown as PrismaClient;

let service: TeamService;

beforeEach(() => {
  vi.clearAllMocks();
  teamFindUnique.mockResolvedValue({
    id: "team_1",
    name: "Shared Team",
    organizationId: "org_1",
    isPersonal: false,
  });
  teamUpdate.mockResolvedValue({});
  // Two direct admins on the team: the removal of one is allowed, and it is
  // the pair that has to be prevented from both going at once. The `userId`
  // filter is honoured, so the ids collected for revocation are the leaving
  // member's rather than the whole team's.
  const teamBindings = [
    { id: "rb_a", userId: "user_a", groupId: null },
    { id: "rb_b", userId: "user_b", groupId: null },
  ];
  bindingFindMany.mockImplementation(
    async ({ where }: { where?: Record<string, unknown> }) =>
      where?.userId
        ? teamBindings.filter((b) => b.userId === where.userId)
        : teamBindings,
  );
  bindingFindFirst.mockResolvedValue({ role: TeamUserRole.ADMIN });
  groupMembershipFindMany.mockResolvedValue([]);
  teamUserDeleteMany.mockResolvedValue({ count: 1 });
  revokeBindings.mockResolvedValue(undefined);
  service = new TeamService(
    prisma,
    {} as never,
    { revokeBindings } as unknown as GrantsLedgerWriter,
  );
});

describe("given a team with two admins", () => {
  describe("when one of them is removed", () => {
    it("writes the team row under the same transaction as the membership delete", async () => {
      await service.removeMember({
        teamId: "team_1",
        userId: "user_a",
        currentUserId: "user_b",
      });

      expect(teamUserDeleteMany).toHaveBeenCalled();
      expect(teamUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "team_1" } }),
      );
    });

    it("revokes the grants they held on the team once that has committed", async () => {
      await service.removeMember({
        teamId: "team_1",
        userId: "user_a",
        currentUserId: "user_b",
      });

      expect(revokeBindings).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org_1",
          bindingIds: ["rb_a"],
        }),
      );
    });
  });
});

describe("given a team whose only admin is the person being removed", () => {
  describe("when the removal is attempted", () => {
    it("refuses, and writes nothing", async () => {
      bindingFindMany.mockResolvedValue([
        { id: "rb_a", userId: "user_a", groupId: null },
      ]);

      await expect(
        service.removeMember({
          teamId: "team_1",
          userId: "user_a",
          currentUserId: "user_b",
        }),
      ).rejects.toMatchObject({ code: "team_last_admin_required" });

      expect(teamUserDeleteMany).not.toHaveBeenCalled();
      expect(teamUpdate).not.toHaveBeenCalled();
      expect(revokeBindings).not.toHaveBeenCalled();
    });
  });
});

describe("given the scope of the revocation", () => {
  describe("when the member holds several grants on one team", () => {
    it("collects every one of them, since permissions at a scope are their union", async () => {
      const teamBindings = [
        { id: "rb_a", userId: "user_a", groupId: null },
        { id: "rb_a2", userId: "user_a", groupId: null },
        { id: "rb_b", userId: "user_b", groupId: null },
      ];
      bindingFindMany.mockImplementation(
        async ({ where }: { where?: Record<string, unknown> }) =>
          where?.userId
            ? teamBindings.filter((b) => b.userId === where.userId)
            : teamBindings,
      );

      await service.removeMember({
        teamId: "team_1",
        userId: "user_a",
        currentUserId: "user_b",
      });

      expect(bindingFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: "team_1",
          }),
        }),
      );
      expect(revokeBindings).toHaveBeenCalledWith(
        expect.objectContaining({ bindingIds: ["rb_a", "rb_a2"] }),
      );
    });
  });
});

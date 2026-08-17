import {
  type AuthzReadRepository,
  BindingMissingError,
  DuplicateBindingError,
  type RoleBindingWrite,
} from "@langwatch/authz-server";
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import { Prisma } from "~/generated/prisma/client";
import { PrismaAuthzGrantsRepository } from "../authz-grants.prisma.repository";
import { PrismaAuthzReadRepository } from "../authz-read.prisma.repository";

/**
 * The write adapter's two jobs, neither of which the service can check for
 * itself: ATOMICITY (what runs inside which transaction, and in what order)
 * and the TRANSLATION of Prisma's error codes into the port's named
 * failures. The rules about what may be written live in
 * @langwatch/authz-server.
 */

const prismaError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError("boom", {
    code,
    clientVersion: "test",
  });

const row = (overrides: Partial<RoleBindingWrite> = {}): RoleBindingWrite => ({
  bindingId: "binding-1",
  organizationId: "org-1",
  scopeType: "TEAM",
  scopeId: "team-1",
  role: "MEMBER",
  customRoleId: null,
  principal: { userId: "alice" },
  ...overrides,
});

const actor = { type: "user", id: "actor-1" } as const;

describe("PrismaAuthzGrantsRepository", () => {
  describe("createBinding", () => {
    it("writes the principal union onto exactly one of the three columns", async () => {
      const create = vi.fn().mockResolvedValue({});
      const prisma = {
        roleBinding: { create },
      } as unknown as PrismaClient;

      await new PrismaAuthzGrantsRepository(prisma).createBinding(
        row({ principal: { apiKeyId: "key-1" } }),
        { actor },
      );

      expect(create).toHaveBeenCalledWith({
        data: {
          id: "binding-1",
          organizationId: "org-1",
          scopeType: "TEAM",
          scopeId: "team-1",
          role: "MEMBER",
          customRoleId: null,
          userId: null,
          groupId: null,
          apiKeyId: "key-1",
        },
      });
    });

    describe("when the insert collides with a partial unique index", () => {
      it("raises DuplicateBindingError, never the Prisma error", async () => {
        const prisma = {
          roleBinding: {
            create: vi.fn().mockRejectedValue(prismaError("P2002")),
          },
        } as unknown as PrismaClient;

        await expect(
          new PrismaAuthzGrantsRepository(prisma).createBinding(row(), {
            actor,
          }),
        ).rejects.toBeInstanceOf(DuplicateBindingError);
      });
    });

    describe("when the failure is not one the port names", () => {
      it("lets it through unchanged, so an outage stays an outage", async () => {
        const failure = prismaError("P1001");
        const prisma = {
          roleBinding: { create: vi.fn().mockRejectedValue(failure) },
        } as unknown as PrismaClient;

        await expect(
          new PrismaAuthzGrantsRepository(prisma).createBinding(row(), {
            actor,
          }),
        ).rejects.toBe(failure);
      });
    });
  });

  describe("updateBindingRole", () => {
    describe("when the row is gone", () => {
      it("raises BindingMissingError", async () => {
        const prisma = {
          roleBinding: {
            update: vi.fn().mockRejectedValue(prismaError("P2025")),
          },
        } as unknown as PrismaClient;

        await expect(
          new PrismaAuthzGrantsRepository(prisma).updateBindingRole({
            bindingId: "binding-1",
            organizationId: "org-1",
            role: "ADMIN",
            customRoleId: null,
            actor,
          }),
        ).rejects.toBeInstanceOf(BindingMissingError);
      });
    });

    describe("when the new role collides with a sibling binding", () => {
      it("raises DuplicateBindingError", async () => {
        const prisma = {
          roleBinding: {
            update: vi.fn().mockRejectedValue(prismaError("P2002")),
          },
        } as unknown as PrismaClient;

        await expect(
          new PrismaAuthzGrantsRepository(prisma).updateBindingRole({
            bindingId: "binding-1",
            organizationId: "org-1",
            role: "ADMIN",
            customRoleId: null,
            actor,
          }),
        ).rejects.toBeInstanceOf(DuplicateBindingError);
      });
    });
  });

  describe("deleteBinding", () => {
    describe("when the row went away between the read and the write", () => {
      it("raises BindingMissingError, so it reads as the same not-found", async () => {
        const prisma = {
          roleBinding: {
            delete: vi.fn().mockRejectedValue(prismaError("P2025")),
          },
        } as unknown as PrismaClient;

        await expect(
          new PrismaAuthzGrantsRepository(prisma).deleteBinding({
            bindingId: "binding-1",
            organizationId: "org-1",
            actor,
          }),
        ).rejects.toBeInstanceOf(BindingMissingError);
      });
    });
  });

  describe("replaceBinding", () => {
    it("deletes the broad grant before creating the narrow one, inside ONE transaction", async () => {
      const calls: string[] = [];
      const tx = {
        roleBinding: {
          deleteMany: vi.fn(async () => {
            calls.push("deleteMany");
            return { count: 1 };
          }),
          create: vi.fn(async () => {
            calls.push("create");
            return {};
          }),
        },
      };
      const $transaction = vi.fn(async (run: (t: typeof tx) => unknown) =>
        run(tx),
      );
      const prisma = { $transaction } as unknown as PrismaClient;

      await new PrismaAuthzGrantsRepository(prisma).replaceBinding({
        deleteWhere: {
          organizationId: "org-1",
          scopeType: "ORGANIZATION",
          scopeId: "org-1",
          principal: { userId: "alice" },
        },
        create: row(),
        actor,
      });

      // The order is the REDUCE verb's whole point: a create that landed
      // first would leave the principal briefly holding both grants.
      expect(calls).toEqual(["deleteMany", "create"]);
      expect($transaction).toHaveBeenCalledTimes(1);
      expect(tx.roleBinding.deleteMany).toHaveBeenCalledWith({
        where: {
          organizationId: "org-1",
          scopeType: "ORGANIZATION",
          scopeId: "org-1",
          userId: "alice",
        },
      });
    });

    describe("when the grant being narrowed is already gone", () => {
      it("raises BindingMissingError and creates nothing", async () => {
        const create = vi.fn();
        const tx = {
          roleBinding: {
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            create,
          },
        };
        const prisma = {
          $transaction: vi.fn(async (run: (t: typeof tx) => unknown) =>
            run(tx),
          ),
        } as unknown as PrismaClient;

        await expect(
          new PrismaAuthzGrantsRepository(prisma).replaceBinding({
            deleteWhere: {
              organizationId: "org-1",
              scopeType: "ORGANIZATION",
              scopeId: "org-1",
              principal: { groupId: "group-1" },
            },
            create: row(),
            actor,
          }),
        ).rejects.toBeInstanceOf(BindingMissingError);
        expect(create).not.toHaveBeenCalled();
      });
    });
  });

  describe("offboardUser", () => {
    it("proves against the transaction, after every delete has run in it", async () => {
      const calls: string[] = [];
      const deleteMany = (name: string, count: number) =>
        vi.fn(async () => {
          calls.push(name);
          return { count };
        });
      const findMany = vi.fn().mockResolvedValue([]);
      const findUnique = vi.fn(async () => {
        calls.push("readEmail");
        return { email: "alice@example.com" };
      });
      const tx = {
        roleBinding: { deleteMany: deleteMany("bindings", 2), findMany },
        groupMembership: { deleteMany: deleteMany("groups", 1) },
        teamUser: { deleteMany: deleteMany("teamUsers", 0) },
        organizationUser: { deleteMany: deleteMany("orgUser", 1) },
        user: { findUnique },
        organizationInvite: { deleteMany: deleteMany("invites", 1) },
      };
      const prisma = {
        $transaction: vi.fn(async (run: (t: typeof tx) => unknown) => run(tx)),
      } as unknown as PrismaClient;

      const prove = vi.fn(async (reader: AuthzReadRepository) => {
        calls.push("prove");
        // The reader must be bound to THIS transaction, or the re-collect
        // would read the pre-delete world and prove nothing.
        expect(reader).toBeInstanceOf(PrismaAuthzReadRepository);
        await reader.findUserBindings({
          userId: "alice",
          organizationId: "org-1",
        });
      });

      const counts = await new PrismaAuthzGrantsRepository(prisma).offboardUser(
        {
          userId: "alice",
          organizationId: "org-1",
          actor,
          prove,
        },
      );

      // The address the invite delete matches on is read inside the same
      // transaction, and before that delete: read outside it, a change
      // between the read and the delete would leave a live invite behind
      // that the counts below claim was removed.
      expect(calls).toEqual([
        "bindings",
        "groups",
        "teamUsers",
        "orgUser",
        "readEmail",
        "invites",
        "prove",
      ]);
      expect(findUnique).toHaveBeenCalledWith({
        where: { id: "alice" },
        select: { email: true },
      });
      expect(findMany).toHaveBeenCalledTimes(1);
      expect(counts).toEqual({
        bindings: 2,
        groupMemberships: 1,
        legacyTeamMemberships: 0,
        pendingInvites: 1,
        organizationMembership: true,
      });
    });

    describe("when the proof fails", () => {
      it("propagates, so the transaction rolls the offboarding back", async () => {
        const tx = {
          roleBinding: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
          groupMembership: {
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
          },
          teamUser: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
          organizationUser: {
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
          },
          user: { findUnique: vi.fn().mockResolvedValue(null) },
          organizationInvite: {
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
          },
        };
        const prisma = {
          $transaction: vi.fn(async (run: (t: typeof tx) => unknown) =>
            run(tx),
          ),
        } as unknown as PrismaClient;
        const incomplete = new Error("still resolves");

        await expect(
          new PrismaAuthzGrantsRepository(prisma).offboardUser({
            userId: "alice",
            organizationId: "org-1",
            actor,
            prove: () => Promise.reject(incomplete),
          }),
        ).rejects.toBe(incomplete);
      });
    });

    it("skips the invite delete when the user has no email to match on", async () => {
      const inviteDeleteMany = vi.fn();
      const tx = {
        roleBinding: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
        groupMembership: {
          deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        teamUser: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
        organizationUser: {
          deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        user: { findUnique: vi.fn().mockResolvedValue({ email: null }) },
        organizationInvite: { deleteMany: inviteDeleteMany },
      };
      const prisma = {
        $transaction: vi.fn(async (run: (t: typeof tx) => unknown) => run(tx)),
      } as unknown as PrismaClient;

      const counts = await new PrismaAuthzGrantsRepository(prisma).offboardUser(
        {
          userId: "alice",
          organizationId: "org-1",
          actor,
          prove: () => Promise.resolve(),
        },
      );

      expect(inviteDeleteMany).not.toHaveBeenCalled();
      expect(counts.pendingInvites).toBe(0);
    });
  });

  describe("findCustomRole", () => {
    it("reads the tenancy and the vocabulary in one query", async () => {
      const findUnique = vi
        .fn()
        .mockResolvedValue({ organizationId: "org-1", permissions: ["a:b"] });
      const prisma = {
        customRole: { findUnique },
      } as unknown as PrismaClient;

      const role = await new PrismaAuthzGrantsRepository(prisma).findCustomRole(
        { customRoleId: "role-1" },
      );

      expect(findUnique).toHaveBeenCalledWith({
        where: { id: "role-1" },
        select: { organizationId: true, permissions: true },
      });
      expect(role).toEqual({ organizationId: "org-1", permissions: ["a:b"] });
    });
  });
});

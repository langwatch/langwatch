import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "~/generated/prisma/client";
import { PrismaAuthzReadRepository } from "../authz-read.prisma.repository";

/**
 * The adapter's contract with Prisma: exact query shapes. The POLICIES over
 * these rows are tested in @langwatch/authz-server; what matters here is
 * that the queries filter what they claim to - above all that ShareLink
 * reads are keyed on the presented tokens (the possession gate's storage
 * half), that every binding read is fenced on CURRENT organization
 * membership, and that an API key's private permission role stays with the
 * key it was minted for.
 */
describe("PrismaAuthzReadRepository", () => {
  describe("when reading organization membership", () => {
    describe("when the user is an active member of the organization", () => {
      it("reads the membership row for this user in this organization", async () => {
        const findFirst = vi
          .fn()
          .mockResolvedValue({ role: "ADMIN", disabledAt: null });
        const prisma = {
          organizationUser: { findFirst },
        } as unknown as Prisma.TransactionClient;

        const membership = await new PrismaAuthzReadRepository(
          prisma,
        ).findOrganizationMembership({
          userId: "alice",
          organizationId: "org-1",
        });

        // `disabledAt` is SELECTED and not filtered on purpose: the row is a
        // fact and the collector applies the policy. This assertion is the
        // one that used to pin the opposite - a select without `disabledAt` -
        // which is how a disabled member kept every permission.
        expect(findFirst).toHaveBeenCalledWith({
          where: { userId: "alice", organizationId: "org-1" },
          select: { role: true, disabledAt: true },
        });
        expect(membership).toEqual({ role: "ADMIN", disabled: false });
      });
    });

    describe("when the membership has been disabled to free its seat", () => {
      it("reports the row as disabled rather than hiding it, so the denial can say so", async () => {
        const prisma = {
          organizationUser: {
            findFirst: vi.fn().mockResolvedValue({
              role: "ADMIN",
              disabledAt: new Date("2026-01-01"),
            }),
          },
        } as unknown as Prisma.TransactionClient;

        expect(
          await new PrismaAuthzReadRepository(
            prisma,
          ).findOrganizationMembership({
            userId: "alice",
            organizationId: "org-1",
          }),
        ).toEqual({ role: "ADMIN", disabled: true });
      });
    });

    describe("when the user has no membership row", () => {
      it("reports no membership as null, so the caller fails closed", async () => {
        const prisma = {
          organizationUser: { findFirst: vi.fn().mockResolvedValue(null) },
        } as unknown as Prisma.TransactionClient;

        expect(
          await new PrismaAuthzReadRepository(
            prisma,
          ).findOrganizationMembership({
            userId: "alice",
            organizationId: "org-1",
          }),
        ).toBeNull();
      });
    });
  });

  describe("findUserBindings", () => {
    it("gates the direct binding on current organization membership", async () => {
      const findMany = vi.fn().mockResolvedValue([
        {
          role: "ADMIN",
          customRoleId: null,
          scopeType: "TEAM",
          scopeId: "team-1",
        },
      ]);
      const prisma = {
        roleBinding: { findMany },
      } as unknown as Prisma.TransactionClient;

      const rows = await new PrismaAuthzReadRepository(prisma).findUserBindings(
        {
          userId: "alice",
          organizationId: "org-1",
        },
      );

      expect(findMany).toHaveBeenCalledWith({
        where: {
          organizationId: "org-1",
          userId: "alice",
          user: {
            orgMemberships: {
              some: { organizationId: "org-1", disabledAt: null },
            },
          },
        },
        select: {
          role: true,
          customRoleId: true,
          scopeType: true,
          scopeId: true,
        },
      });
      expect(rows).toEqual([
        {
          role: "ADMIN",
          customRoleId: null,
          scopeType: "TEAM",
          scopeId: "team-1",
          viaGroupId: null,
        },
      ]);
    });
  });

  describe("findGroupBindings", () => {
    it("reaches bindings through group membership and stamps viaGroupId", async () => {
      const findMany = vi.fn().mockResolvedValue([
        {
          role: "MEMBER",
          customRoleId: null,
          scopeType: "PROJECT",
          scopeId: "proj-1",
          groupId: "group-1",
        },
      ]);
      const prisma = {
        roleBinding: { findMany },
      } as unknown as Prisma.TransactionClient;

      const rows = await new PrismaAuthzReadRepository(
        prisma,
      ).findGroupBindings({ userId: "alice", organizationId: "org-1" });

      // The membership gate sits on the GROUP MEMBER, not on the binding: a
      // GroupMembership row outlives removal from the organization, so
      // without it an offboarded user keeps what their groups granted. It
      // outlives the MEMBERSHIP too now — a removal marks the row — so
      // `removedAt: null` is the second half of the same gate.
      expect(findMany).toHaveBeenCalledWith({
        where: {
          organizationId: "org-1",
          group: {
            members: {
              some: {
                userId: "alice",
                removedAt: null,
                user: {
                  orgMemberships: {
                    some: { organizationId: "org-1", disabledAt: null },
                  },
                },
              },
            },
          },
        },
        select: {
          role: true,
          customRoleId: true,
          scopeType: true,
          scopeId: true,
          groupId: true,
        },
      });
      expect(rows).toEqual([
        {
          role: "MEMBER",
          customRoleId: null,
          scopeType: "PROJECT",
          scopeId: "proj-1",
          viaGroupId: "group-1",
        },
      ]);
    });
  });

  describe("findApiKeyBindings", () => {
    it("reads the key's own bindings in this organization, with no membership gate", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const prisma = {
        roleBinding: { findMany },
      } as unknown as Prisma.TransactionClient;

      await new PrismaAuthzReadRepository(prisma).findApiKeyBindings({
        apiKeyId: "key-1",
        organizationId: "org-1",
      });

      // A key has no OrganizationUser row of its own - the owner's standing
      // enters as the §9 ceiling, computed elsewhere, never as a predicate
      // here.
      expect(findMany).toHaveBeenCalledWith({
        where: { organizationId: "org-1", apiKeyId: "key-1" },
        select: {
          role: true,
          customRoleId: true,
          scopeType: true,
          scopeId: true,
        },
      });
    });
  });

  describe("findApiKeyOwner", () => {
    describe("when the key belongs to a user", () => {
      it("returns the owning user id for a personal key", async () => {
        const findUnique = vi.fn().mockResolvedValue({ userId: "alice" });
        const prisma = {
          apiKey: { findUnique },
        } as unknown as Prisma.TransactionClient;

        const owner = await new PrismaAuthzReadRepository(
          prisma,
        ).findApiKeyOwner("key-1");

        expect(findUnique).toHaveBeenCalledWith({
          where: { id: "key-1" },
          select: { userId: true },
        });
        expect(owner).toEqual({ userId: "alice" });
      });
    });

    describe("when the key is a service key or does not exist", () => {
      it("distinguishes a service key from a key that is not there", async () => {
        const findUnique = vi
          .fn()
          .mockResolvedValueOnce({ userId: null })
          .mockResolvedValueOnce(null);
        const prisma = {
          apiKey: { findUnique },
        } as unknown as Prisma.TransactionClient;
        const repository = new PrismaAuthzReadRepository(prisma);

        // { userId: null } carries no ceiling; null is an unknown key.
        expect(await repository.findApiKeyOwner("service-key")).toEqual({
          userId: null,
        });
        expect(await repository.findApiKeyOwner("ghost")).toBeNull();
      });
    });
  });

  describe("findCustomRolePermissions", () => {
    describe("when the principal is a user", () => {
      it("fences on the organization and excludes every API-key system role", async () => {
        const findMany = vi.fn().mockResolvedValue([]);
        const prisma = {
          customRole: { findMany },
        } as unknown as Prisma.TransactionClient;

        await new PrismaAuthzReadRepository(prisma).findCustomRolePermissions({
          organizationId: "org-1",
          principal: { type: "user", id: "alice" },
          customRoleIds: ["role-1", "role-2"],
        });

        expect(findMany).toHaveBeenCalledWith({
          where: {
            id: { in: ["role-1", "role-2"] },
            organizationId: "org-1",
            kind: { not: "system_api_key" },
          },
          select: { id: true, permissions: true },
        });
      });
    });

    describe("when the principal is an API key", () => {
      it("allows the key's OWN system role and excludes every other key's", async () => {
        const findMany = vi.fn().mockResolvedValue([]);
        const prisma = {
          customRole: { findMany },
        } as unknown as Prisma.TransactionClient;

        await new PrismaAuthzReadRepository(prisma).findCustomRolePermissions({
          organizationId: "org-1",
          principal: { type: "apiKey", id: "key-1" },
          customRoleIds: ["role-1"],
        });

        // "Its own" is the same exclusivity the role repository uses: every
        // binding on the role belongs to this key, and no legacy assignment
        // holds it. A binding from key A to key B's system role would
        // otherwise hand B's permissions to A.
        expect(findMany).toHaveBeenCalledWith({
          where: {
            id: { in: ["role-1"] },
            organizationId: "org-1",
            OR: [
              { kind: { not: "system_api_key" } },
              {
                roleBindings: {
                  some: { apiKeyId: "key-1" },
                  every: { apiKeyId: "key-1" },
                },
                assignedUsers: { none: {} },
              },
            ],
          },
          select: { id: true, permissions: true },
        });
      });

      describe("when a system role carries no bindings at all", () => {
        it("excludes it, because `every` alone is vacuously true on an empty relation", async () => {
          const findMany = vi.fn().mockResolvedValue([]);
          const prisma = {
            customRole: { findMany },
          } as unknown as Prisma.TransactionClient;

          await new PrismaAuthzReadRepository(prisma).findCustomRolePermissions(
            {
              organizationId: "org-1",
              principal: { type: "apiKey", id: "key-1" },
              customRoleIds: ["orphan-role"],
            },
          );

          // A bindingless system role satisfies `every: { apiKeyId }` for
          // EVERY key on the platform, so `every` on its own let any key
          // that named such a role collect its permissions. The `some`
          // clause is the half that requires the role to have been minted
          // for this key; without it the guard admits the orphan.
          const branch = findMany.mock.calls[0]?.[0]?.where?.OR?.[1];
          // The whole branch, not a dereferenced path: shape drift should
          // fail this assertion, not throw a TypeError on the way to it.
          expect(branch).toMatchObject({
            roleBindings: {
              some: { apiKeyId: "key-1" },
              every: { apiKeyId: "key-1" },
            },
          });
        });
      });
    });
  });

  describe("findShareLinks", () => {
    it("filters by presented token AND the resource links, project-anchored", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const prisma = {
        shareLink: { findMany },
      } as unknown as Prisma.TransactionClient;

      await new PrismaAuthzReadRepository(prisma).findShareLinks({
        projectId: "proj-1",
        tokens: ["tok-1"],
        links: [
          { kind: "trace", id: "trace-1" },
          { kind: "thread", id: "thread-1" },
        ],
      });

      expect(findMany).toHaveBeenCalledWith({
        where: {
          projectId: "proj-1",
          token: { in: ["tok-1"] },
          OR: [
            { resourceType: "TRACE", resourceId: "trace-1" },
            { resourceType: "THREAD", resourceId: "thread-1" },
          ],
        },
        select: {
          resourceType: true,
          resourceId: true,
          projectId: true,
          visibility: true,
          permission: true,
          expiresAt: true,
          maxViews: true,
          viewCount: true,
        },
      });
    });
  });

  describe("findLegacyTeamMemberships", () => {
    it("scopes TeamUser rows to the organization and flattens the personal flag", async () => {
      const findMany = vi.fn().mockResolvedValue([
        {
          teamId: "team-1",
          role: "VIEWER",
          assignedRoleId: null,
          team: { isPersonal: true },
        },
      ]);
      const prisma = {
        teamUser: { findMany },
      } as unknown as Prisma.TransactionClient;

      const rows = await new PrismaAuthzReadRepository(
        prisma,
      ).findLegacyTeamMemberships({ userId: "alice", organizationId: "org-1" });

      // Two predicates, not one: the team is in this organization AND the
      // user is a current member of it. A stale cross-org TeamUser row must
      // not confer access any more than a stale RoleBinding.
      expect(findMany).toHaveBeenCalledWith({
        where: {
          userId: "alice",
          team: {
            organizationId: "org-1",
            organization: {
              members: { some: { userId: "alice", disabledAt: null } },
            },
          },
        },
        select: {
          teamId: true,
          role: true,
          assignedRoleId: true,
          team: { select: { isPersonal: true } },
        },
      });
      expect(rows).toEqual([
        {
          teamId: "team-1",
          role: "VIEWER",
          customRoleId: null,
          isPersonal: true,
        },
      ]);
    });
  });

  describe("findProjectLineage", () => {
    it("returns the owning team and organization, null for an unknown project", async () => {
      const findUnique = vi
        .fn()
        .mockResolvedValueOnce({
          team: { id: "team-1", organizationId: "org-1" },
        })
        .mockResolvedValueOnce(null);
      const prisma = {
        project: { findUnique },
      } as unknown as Prisma.TransactionClient;
      const repository = new PrismaAuthzReadRepository(prisma);

      expect(
        await repository.findProjectLineage({ projectId: "proj-1" }),
      ).toEqual({ teamId: "team-1", organizationId: "org-1" });
      expect(
        await repository.findProjectLineage({ projectId: "proj-ghost" }),
      ).toBeNull();
    });
  });
});

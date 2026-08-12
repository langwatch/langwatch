import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { PrismaAuthzReadRepository } from "../authz-read.prisma.repository";

/**
 * The adapter's contract with Prisma: exact query shapes. The POLICIES over
 * these rows are tested in @langwatch/authz-server; what matters here is
 * that the queries filter what they claim to - above all that ShareLink
 * reads are keyed on the presented tokens, which is the possession gate's
 * storage half.
 */
describe("PrismaAuthzReadRepository", () => {
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
          expiresAt: true,
          maxViews: true,
          viewCount: true,
        },
      });
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

      expect(findMany).toHaveBeenCalledWith({
        where: {
          organizationId: "org-1",
          group: { members: { some: { userId: "alice" } } },
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

      expect(findMany).toHaveBeenCalledWith({
        where: { userId: "alice", team: { organizationId: "org-1" } },
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

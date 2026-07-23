import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { PrismaShareRepository } from "../repositories/share.prisma.repository";

/**
 * Tenant-isolation guard, carried over from #5834 (which pinned the same
 * property on the pre-ADR-057 `findByResourceType`). Every resource-addressed
 * lookup must carry `projectId` in the query itself, so a cross-tenant row is
 * never returned into memory even transiently.
 *
 * `findByToken` is deliberately exempt: the token is the capability, and the
 * anonymous viewer has no project to scope by. Its tenancy comes from the
 * token's unguessability plus the audience check in `ShareService`.
 */
describe("PrismaShareRepository tenant scoping", () => {
  const buildRepository = (shareLink: Record<string, unknown>) =>
    new PrismaShareRepository({ shareLink } as unknown as PrismaClient);

  describe("when looking a link up by id", () => {
    it("scopes the query by projectId", async () => {
      const findFirst = vi.fn().mockResolvedValue(null);
      const repository = buildRepository({ findFirst });

      await repository.findById({ id: "share_1", projectId: "project_1" });

      expect(findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "share_1", projectId: "project_1" },
        }),
      );
    });
  });

  describe("when listing the links for a resource", () => {
    it("scopes the query by projectId", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const repository = buildRepository({ findMany });

      await repository.listByResource({
        projectId: "project_1",
        resourceType: "TRACE",
        resourceId: "trace_1",
      });

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            projectId: "project_1",
            resourceType: "TRACE",
            resourceId: "trace_1",
          },
        }),
      );
    });
  });

  describe("when checking whether a resource is actively shared", () => {
    it("scopes the query by projectId", async () => {
      const count = vi.fn().mockResolvedValue(0);
      const repository = buildRepository({ count });

      await repository.hasActiveShareForResource({
        projectId: "project_1",
        resourceType: "TRACE",
        resourceId: "trace_1",
      });

      expect(count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            projectId: "project_1",
            resourceType: "TRACE",
            resourceId: "trace_1",
          }),
        }),
      );
    });
  });
});

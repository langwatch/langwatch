import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it, vi } from "vitest";

import { PrismaShareRepository } from "../prisma.share.repository.ts";

/**
 * Tenant-isolation guard: resource-addressed queries must include projectId.
 * findByToken is exempt: the token itself is the capability.
 */
describe("PrismaShareRepository tenant scoping", () => {
  const buildRepository = (shareLink: Record<string, unknown>) =>
    PrismaShareRepository.create({
      prisma: prismaDouble({ shareLink }),
    });

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

      await repository.findAllByResource({
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

      await repository.countActiveForResource({
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

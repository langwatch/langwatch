import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { PrismaShareRepository } from "../repositories/share.prisma.repository";

describe("PrismaShareRepository", () => {
  describe("when consuming a share view", () => {
    it("checks expiry and the view cap in the atomic update", async () => {
      const updateMany = vi.fn().mockResolvedValue({ count: 1 });
      const repository = new PrismaShareRepository({
        shareLink: { updateMany },
      } as unknown as PrismaClient);

      await repository.incrementViewCount({
        id: "share_1",
        projectId: "project_1",
        maxViews: 1,
      });

      expect(updateMany).toHaveBeenCalledWith({
        where: {
          id: "share_1",
          projectId: "project_1",
          OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
          viewCount: { lt: 1 },
        },
        data: { viewCount: { increment: 1 } },
      });
    });
  });
});

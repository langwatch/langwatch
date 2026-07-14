import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { PrismaShareLifecycleLocker } from "../share.lifecycleLock";

describe("PrismaShareLifecycleLocker", () => {
  describe("when running a resource lifecycle operation", () => {
    it("holds a project-and-resource-scoped advisory lock", async () => {
      const executeRaw = vi.fn().mockResolvedValue(0);
      const transaction = vi.fn(async (callback) =>
        callback({ $executeRaw: executeRaw }),
      );
      const locker = new PrismaShareLifecycleLocker({
        $transaction: transaction,
      } as unknown as PrismaClient);
      const operation = vi.fn().mockResolvedValue("done");

      const result = await locker.run({
        projectId: "project_1",
        resourceType: "TRACE",
        resourceId: "trace_1",
        operation,
      });

      expect(result).toBe("done");
      expect(operation).toHaveBeenCalledOnce();
      expect(executeRaw.mock.calls[0]?.[1]).toBe(
        "share:project_1:TRACE:trace_1",
      );
    });
  });
});

import { describe, expect, it, vi } from "vitest";
import { LwqlProvisionTask, type LwqlProvisioningDatabase } from "../lwql-provision.task";

describe("LwqlProvisionTask", () => {
  describe("given no LWQL_* environment is configured", () => {
    /** @scenario "A task runs by name with its arguments" */
    it("is named lwql-provision and skips without touching the database", async () => {
      const database: LwqlProvisioningDatabase = {
        $executeRawUnsafe: vi.fn(),
        project: { findMany: vi.fn() },
      };
      const task = LwqlProvisionTask.create({ database: () => database });
      expect(task.name).toBe("lwql-provision");

      const controller = new AbortController();
      await task.run({ args: [], signal: controller.signal });

      expect(database.$executeRawUnsafe).not.toHaveBeenCalled();
      expect(database.project.findMany).not.toHaveBeenCalled();
    });
  });
});

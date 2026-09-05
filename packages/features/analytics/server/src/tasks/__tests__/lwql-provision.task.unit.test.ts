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
      const task = LwqlProvisionTask.create({ database: () => database, source: {} });
      expect(task.name).toBe("lwql-provision");

      const controller = new AbortController();
      await task.run({ args: [], signal: controller.signal });

      expect(database.$executeRawUnsafe).not.toHaveBeenCalled();
      expect(database.project.findMany).not.toHaveBeenCalled();
    });
  });

  describe("when the deploy sets SKIP_LWQL_PROVISION", () => {
    /** @scenario "The operator opt-out skips LangWatchQL provisioning in the boot chain" */
    it("provisions nothing and reads no project rows", async () => {
      const database: LwqlProvisioningDatabase = {
        $executeRawUnsafe: vi.fn(),
        project: { findMany: vi.fn() },
      };
      const task = LwqlProvisionTask.create({
        database: () => database,
        source: {},
        skipped: true,
      });

      await task.run({ args: [], signal: new AbortController().signal });

      expect(database.$executeRawUnsafe).not.toHaveBeenCalled();
      expect(database.project.findMany).not.toHaveBeenCalled();
    });
  });
});

import { describe, expect, it, vi } from "vitest";

import { LwqlProvisionTask, type LwqlProvisioningDatabase } from "../lwql-provision.task.ts";

function untouchedDatabase(): LwqlProvisioningDatabase {
  return { $executeRawUnsafe: vi.fn(), $transaction: vi.fn(), project: { findMany: vi.fn() } };
}

describe("LwqlProvisionTask", () => {
  describe("given no LWQL_* environment is configured", () => {
    /** @scenario "A task runs by name with its arguments" */
    it("is named lwql-provision and skips without touching the database", async () => {
      const database = untouchedDatabase();
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
      const database = untouchedDatabase();
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

  describe("when LWQL_SELF_PROVISION is true but the reader password never arrived", () => {
    it("declines this boot without touching either database", async () => {
      const database = untouchedDatabase();
      const task = LwqlProvisionTask.create({
        database: () => database,
        source: {
          LWQL_SELF_PROVISION: "true",
          CLICKHOUSE_URL: "http://admin:secret@clickhouse:8123/langwatch",
          LWQL_CLICKHOUSE_PASSWORD: "restricted",
          DATABASE_URL: "postgresql://app:secret@postgres/langwatch",
        },
      });

      await task.run({ args: [], signal: new AbortController().signal });

      expect(database.$transaction).not.toHaveBeenCalled();
      expect(database.$executeRawUnsafe).not.toHaveBeenCalled();
      expect(database.project.findMany).not.toHaveBeenCalled();
    });
  });
});

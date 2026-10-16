import { describe, expect, it, vi } from "vitest";

import type { LwqlProvisioningDatabase } from "../../repositories/langwatch-ql-postgres.repository.ts";
import {
  APP_FUNCTION_SPLIT_CODE,
  LwqlProvisionTask,
  verifyAppFunctionsOnEveryReplica,
} from "../lwql-provision.task.ts";

function untouchedDatabase(): LwqlProvisioningDatabase {
  return { $executeRawUnsafe: vi.fn(), $transaction: vi.fn() };
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
    });
  });

  describe("when the restricted password is set but the reader password never arrived", () => {
    it("declines this boot without touching either database", async () => {
      const database = untouchedDatabase();
      const task = LwqlProvisionTask.create({
        database: () => database,
        source: {
          CLICKHOUSE_URL: "http://admin:secret@clickhouse:8123/langwatch",
          LWQL_CLICKHOUSE_PASSWORD: "restricted",
          DATABASE_URL: "postgresql://app:secret@postgres/langwatch",
        },
      });

      await task.run({ args: [], signal: new AbortController().signal });

      expect(database.$transaction).not.toHaveBeenCalled();
      expect(database.$executeRawUnsafe).not.toHaveBeenCalled();
    });
  });

  describe("when CLICKHOUSE_URL parses but names an invalid database identifier", () => {
    /** @scenario "An unparsable ClickHouse database name does not crash boot" */
    it("returns without throwing instead of crashing the deploy task", async () => {
      const database = untouchedDatabase();
      const task = LwqlProvisionTask.create({
        database: () => database,
        source: {
          LWQL_CLICKHOUSE_PASSWORD: "restricted-pw",
          LWQL_POSTGRES_READER_PASSWORD: "reader-pw",
          CLICKHOUSE_URL: "http://clickhouse:8123/bad-db!",
          DATABASE_URL: "postgresql://app:app@postgres:5432/app",
        },
      });

      await expect(
        task.run({ args: [], signal: new AbortController().signal }),
      ).resolves.toBeUndefined();
      expect(database.$transaction).not.toHaveBeenCalled();
    });
  });

  describe("when the upgrade's reconciler runs it and the provisioning fails", () => {
    /** @scenario "A LangWatchQL provisioning failure fails the upgrade run" */
    it("rejects instead of logging and continuing", async () => {
      const task = LwqlProvisionTask.create({
        database: () => untouchedDatabase(),
        source: {
          LWQL_CLICKHOUSE_PASSWORD: "restricted-pw",
          LWQL_POSTGRES_READER_PASSWORD: "reader-pw",
          CLICKHOUSE_URL: "http://clickhouse:8123/bad-db!",
          DATABASE_URL: "postgresql://app:app@postgres:5432/app",
        },
        failOnError: true,
      });

      await expect(task.run({ args: [], signal: new AbortController().signal })).rejects.toThrow(
        'Invalid database name: "bad-db!"',
      );
    });
  });
});

describe("verifyAppFunctionsOnEveryReplica", () => {
  const missingOnOneHost = {
    name: "llm_readable_thread",
    missingOn: ["ch-1"],
    inKeeper: true,
    oneDefinition: true,
  };

  describe("when a Keeper-backed replica picks the function up within the wait", () => {
    it("passes once every replica lists it", async () => {
      const answers = [[missingOnOneHost], []];
      await expect(
        verifyAppFunctionsOnEveryReplica({
          findSplit: () => Promise.resolve(answers.shift() ?? []),
          waitMs: 1_000,
          pollMs: 1,
        }),
      ).resolves.toBeUndefined();
      expect(answers).toEqual([]);
    });
  });

  describe("when a function stays missing on one host", () => {
    /** @scenario "A created app function missing on one replica fails the provisioning step" */
    it("fails the step with the stable code", async () => {
      await expect(
        verifyAppFunctionsOnEveryReplica({
          findSplit: () => Promise.resolve([missingOnOneHost]),
          waitMs: 20,
          pollMs: 1,
        }),
      ).rejects.toMatchObject({ code: APP_FUNCTION_SPLIT_CODE });
    });
  });
});

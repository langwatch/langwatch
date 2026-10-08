import { describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import {
  CLICKHOUSE_MIGRATION_LOCK_KEY,
  withClickHouseMigrationLock,
} from "../migrationLock";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const lockIsFree = async () => {
  const rows = await prisma.$queryRaw<Array<{ acquired: boolean }>>`
    -- @tenancy: test probe on a global boot lock, no tenant scope
    SELECT pg_try_advisory_xact_lock(hashtextextended(${CLICKHOUSE_MIGRATION_LOCK_KEY}, 0)) AS acquired`;
  return rows[0]?.acquired === true;
};

describe("Feature: Pods booting together run the ClickHouse migrations one at a time", () => {
  describe("when two pods start the migration step at the same moment", () => {
    /** @scenario "Two migration runs started together never overlap" */
    it("runs one after the other", async () => {
      const order: string[] = [];
      const run = async (pod: string) => {
        order.push(`start:${pod}`);
        await sleep(200);
        order.push(`end:${pod}`);
      };

      await Promise.all([
        withClickHouseMigrationLock({ prisma }, () => run("a")),
        withClickHouseMigrationLock({ prisma }, () => run("b")),
      ]);

      expect(order).toEqual(
        order[0] === "start:a"
          ? ["start:a", "end:a", "start:b", "end:b"]
          : ["start:b", "end:b", "start:a", "end:a"],
      );
    });
  });

  describe("when a pod's migration run finishes", () => {
    /** @scenario "The migration lock is released when the run ends" */
    it("leaves the lock free for the next caller", async () => {
      const heldInside = await withClickHouseMigrationLock(
        { prisma },
        async () => !(await lockIsFree()),
      );

      expect(heldInside).toBe(true);
      expect(await lockIsFree()).toBe(true);
    });
  });

  describe("when a pod's migration run throws", () => {
    /** @scenario "A failed migration run releases the lock" */
    it("rethrows and leaves the lock free", async () => {
      await expect(
        withClickHouseMigrationLock({ prisma }, async () => {
          throw new Error("migration 00064 failed");
        }),
      ).rejects.toThrow("migration 00064 failed");

      expect(await lockIsFree()).toBe(true);
    });
  });
});

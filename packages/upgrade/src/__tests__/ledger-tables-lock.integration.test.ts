/**
 * @vitest-environment node
 * @see specs/upgrade/upgrade-stuck-states-locks.feature
 * Requires LANGWATCH_TEST_DATABASE_URL; the test gets its own Postgres schema.
 */
import { Pool, type PoolClient } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createLedgerTables, LEDGER_LOCK_TIMEOUT_MS } from "../ledger-tables.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("creating the ledger while another session holds a lock", () => {
  const name = `ledger_lock_${Date.now().toString(36)}`;
  const ledgerSchema = `${name}_upgrade_ledger`;
  let admin: Pool;
  let postgres: Pool;
  let holder: PoolClient;

  beforeEach(async () => {
    admin = new Pool({ connectionString: DB_URL, max: 2 });
    await admin.query(`CREATE SCHEMA "${name}"`);
    postgres = new Pool({ connectionString: DB_URL, max: 1, options: `-c search_path=${name}` });
    holder = await admin.connect();
  });

  afterEach(async () => {
    await holder.query("ROLLBACK");
    holder.release();
    await postgres.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${ledgerSchema}", "${name}" CASCADE`);
    await admin.end();
  });

  /** What creating the ledger answers while the lock is held, and how long it took. */
  async function createUnderLock(): Promise<{ error: unknown; elapsedMs: number }> {
    const startedAt = performance.now();
    const error = await createLedgerTables({ postgres }).then(
      () => null,
      (failure: unknown) => failure,
    );
    return { error, elapsedMs: performance.now() - startedAt };
  }

  describe("when another creator holds the ledger's advisory lock", () => {
    /** @scenario "Ledger creation gives up on a held advisory lock instead of waiting forever" */
    it("fails with lock_not_available within the lock timeout", async () => {
      await holder.query("BEGIN");
      await holder.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `langwatch-upgrade-ledger:${ledgerSchema}`,
      ]);
      const { error, elapsedMs } = await createUnderLock();
      expect(error).toMatchObject({ code: "55P03" });
      expect(elapsedMs).toBeLessThan(LEDGER_LOCK_TIMEOUT_MS + 3_000);
    });
  });

  describe("when a long transaction holds a ledger table", () => {
    /** @scenario "Ledger creation gives up on a held ledger table instead of waiting forever" */
    it("fails with lock_not_available within the lock timeout", async () => {
      await createLedgerTables({ postgres });
      await holder.query("BEGIN");
      await holder.query(
        `LOCK TABLE "${ledgerSchema}"."_langwatch_serving_roster" IN ACCESS SHARE MODE`,
      );
      const { error, elapsedMs } = await createUnderLock();
      expect(error).toMatchObject({ code: "55P03" });
      expect(elapsedMs).toBeLessThan(LEDGER_LOCK_TIMEOUT_MS + 3_000);
    });
  });
});

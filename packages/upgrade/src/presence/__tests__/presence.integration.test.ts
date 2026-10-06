/**
 * Presence over the real ledger: every test gets its own Postgres schema and drops it afterwards.
 * Requires LANGWATCH_TEST_DATABASE_URL; the clock that judges liveness is the database's.
 */
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createLedgerTables } from "../../ledger-tables.ts";
import { UpgradeLedgerRepository } from "../../ledger.repository.ts";
import { type PresenceDeclaration, createPresence } from "../index.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
const STEP = "trace:backfill-cost";

const newWorker: PresenceDeclaration = {
  processId: "worker-new-1",
  role: "worker",
  image: "git-abc1234",
  release: null,
  steps: [STEP],
};
const oldApi: PresenceDeclaration = {
  processId: "api-old-1",
  role: "api",
  image: "git-0ld0000",
  release: null,
  steps: [],
};

interface Scratch {
  postgres: Pool;
  drop(): Promise<void>;
}

async function openScratch(): Promise<Scratch> {
  const name = `upgrade_presence_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const admin = new Pool({ connectionString: DB_URL, max: 1 });
  await admin.query(`CREATE SCHEMA "${name}"`);
  const postgres = new Pool({
    connectionString: DB_URL,
    max: 2,
    options: `-c search_path=${name}`,
  });
  return {
    postgres,
    drop: async () => {
      await postgres.end();
      await admin.query(`DROP SCHEMA "${name}" CASCADE`);
      await admin.end();
    },
  };
}

describe.skipIf(!DB_URL)("presence over the upgrade ledger", () => {
  let scratch: Scratch;

  const presenceOf = () =>
    createPresence({
      ledger: UpgradeLedgerRepository.create({ postgres: scratch.postgres }),
      staleAfterMs: 60_000,
      refreshEveryMs: 15_000,
    });

  beforeEach(async () => {
    scratch = await openScratch();
    await createLedgerTables({ postgres: scratch.postgres });
  });

  afterEach(async () => {
    await scratch.drop();
  });

  describe("when old and new builds serve side by side", () => {
    /** @scenario "Old writers are gone only when every live process declares the step" */
    it("answers gone only once the old api has stopped", async () => {
      const api = presenceOf();
      const worker = presenceOf();
      await api.record(oldApi);
      await worker.record(newWorker);

      expect(await worker.oldWritersGoneFor({ stepId: STEP })).toBe(false);
      await api.stop();
      expect(await worker.oldWritersGoneFor({ stepId: STEP })).toBe(true);
      await worker.stop();
    });
  });

  describe("when a process stops gracefully", () => {
    /** @scenario "A gracefully stopped process is no longer live" */
    it("leaves no live row for it and keeps the other process live", async () => {
      const api = presenceOf();
      const worker = presenceOf();
      await api.record(oldApi);
      await worker.record(newWorker);

      await worker.stop();

      expect((await api.live()).map((row) => row.processId)).toEqual([oldApi.processId]);
      await api.stop();
      expect(await api.live()).toEqual([]);
    });
  });
});

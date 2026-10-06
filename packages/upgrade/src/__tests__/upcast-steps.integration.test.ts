/**
 * @vitest-environment node
 * @see packages/eventing/specs/event-upcast.feature
 * Requires LANGWATCH_TEST_DATABASE_URL; the test gets its own Postgres schema.
 */
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { UpgradeLedgerRepository } from "../ledger.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
const schema = `upgrade_upcast_${Date.now().toString(36)}`;

let admin: Pool;
let postgres: Pool;
let ledger: UpgradeLedgerRepository;

const upcast = (storedEvents: number) => ({
  id: "upcast:entitlement:lw.usage.month_counted",
  storedEvents,
  report: {
    pipeline: "entitlement",
    from: "lw.usage.month_counted",
    to: "lw.entitlement.month_counted",
  },
});

describe.skipIf(!DB_URL)("the migrations ledger", () => {
  beforeEach(async () => {
    admin = new Pool({ connectionString: DB_URL, max: 1 });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    postgres = new Pool({ connectionString: DB_URL, max: 2, options: `-c search_path=${schema}` });
    ledger = UpgradeLedgerRepository.create({ postgres });
    await ledger.createTables();
  });

  afterEach(async () => {
    await postgres.end();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  });

  describe("when the active upcasts are recorded", () => {
    /** @scenario "Each declared upcast is a step in the migrations ledger" */
    it("holds a background event-upcast step, pending while it covers stored events", async () => {
      const run = await ledger.startRun({ kind: "upgrade" });

      await ledger.recordUpcastSteps({ runId: run.id, steps: [upcast(3)] });
      const pending = await ledger.findSteps();
      await ledger.recordUpcastSteps({ runId: run.id, steps: [upcast(0)] });
      const done = await ledger.findSteps();

      expect(pending).toEqual([
        expect.objectContaining({
          id: "upcast:entitlement:lw.usage.month_counted",
          kind: "event-upcast",
          mode: "background",
          status: "pending",
          inferred: false,
          report: expect.objectContaining({ storedEvents: 3, to: "lw.entitlement.month_counted" }),
        }),
      ]);
      expect(done).toEqual([
        expect.objectContaining({
          status: "done",
          report: expect.objectContaining({ storedEvents: 0 }),
        }),
      ]);
    });
  });
});

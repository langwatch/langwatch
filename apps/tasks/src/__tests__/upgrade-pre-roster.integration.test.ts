/**
 * The overrides for writers before the roster over a real ledger, one scratch schema per test.
 * Requires LANGWATCH_TEST_DATABASE_URL (Postgres in CI).
 */
import { PrismaDriverAdapterService } from "@langwatch/prisma-client";
import { createLedgerTables } from "@langwatch/upgrade";
import { PreRosterRepository } from "@langwatch/upgrade/serving-roster";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runPreRosterCommand } from "../upgrade.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
const STEP = "trace:backfill-cost";

describe.skipIf(!DB_URL)("upgrade old-writers-gone and pre-roster-rollback", () => {
  type Pool = ReturnType<PrismaDriverAdapterService["create"]>["pool"];
  let postgres: Pool;
  let admin: Pool;
  let name: string;
  const poolOf = (url: string) => PrismaDriverAdapterService.create().create(url).pool;

  beforeEach(async () => {
    name = `upgrade_pre_roster_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    admin = poolOf(DB_URL!);
    await admin.query(`CREATE SCHEMA "${name}"`);
    const url = new URL(DB_URL!);
    url.searchParams.set("schema", name);
    postgres = poolOf(url.toString());
    const t = await createLedgerTables({ postgres });
    await postgres.query(
      `INSERT INTO ${t.run} ("id", "kind", "started_at", "finished_at", "outcome", "report") VALUES
         ('seed-1', 'seed', (now() AT TIME ZONE 'UTC') - interval '2 minutes', (now() AT TIME ZONE 'UTC') - interval '2 minutes', 'succeeded',
          '{"seeded":{"prisma-migration":3}}'),
         ('run-1', 'upgrade', (now() AT TIME ZONE 'UTC') - interval '1 minute', (now() AT TIME ZONE 'UTC') - interval '1 minute', 'succeeded', NULL)`,
    );
    await postgres.query(
      `INSERT INTO ${t.step} ("id", "kind", "mode", "status", "updated_at")
       VALUES ($1, 'data', 'background', 'done', (now() AT TIME ZONE 'UTC'))`,
      [STEP],
    );
  });

  afterEach(async () => {
    await postgres.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${name}_upgrade_ledger", "${name}" CASCADE`);
    await admin.end();
  });

  const run = async (command: "old-writers-gone" | "pre-roster-rollback") => {
    const lines: string[] = [];
    const exitCode = await runPreRosterCommand({
      command,
      postgres,
      write: (text) => lines.push(text),
      actor: "test",
    });
    return { exitCode, output: lines.join("") };
  };

  /** @scenario "upgrade old-writers-gone records the assertion and releases the held steps" */
  it("records the assertion after the seed", async () => {
    const repository = PreRosterRepository.create({ postgres });
    const before = await repository.findPreRosterHistory();
    expect(before.seededFromExistingAt).not.toBeNull();
    expect(before.assertionsAt).toEqual([]);

    const { exitCode, output } = await run("old-writers-gone");

    expect(exitCode).toBe(0);
    expect(output).toContain("steps that wait for old writers run");
    const after = await repository.findPreRosterHistory();
    expect(after.assertionsAt).toHaveLength(1);
    expect(after.assertionsAt[0]!.getTime()).toBeGreaterThan(after.seededFromExistingAt!.getTime());
  });

  /** @scenario "upgrade pre-roster-rollback reopens done background steps and holds old-writers steps again" */
  it("reopens the done background step and records the rollback after the assertion", async () => {
    await run("old-writers-gone");

    const { exitCode, output } = await run("pre-roster-rollback");

    expect(exitCode).toBe(0);
    expect(output).toContain(`reopened: ${STEP}`);
    const t = await createLedgerTables({ postgres });
    const { rows } = await postgres.query<{ status: string }>(
      `SELECT "status" FROM ${t.step} WHERE "id" = $1`,
      [STEP],
    );
    expect(rows[0]?.status).toBe("pending");
    const history = await PreRosterRepository.create({ postgres }).findPreRosterHistory();
    expect(history.rollbacksAt[0]!.getTime()).toBeGreaterThan(history.assertionsAt[0]!.getTime());
  });
});

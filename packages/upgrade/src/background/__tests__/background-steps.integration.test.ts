/**
 * The worker's background steps over a real ledger: each test gets its own schema. Requires
 * LANGWATCH_TEST_DATABASE_URL. Spec: specs/upgrade/background-steps.feature.
 */
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createLedgerTables } from "../../ledger-tables.ts";
import { UpgradeLedgerRepository } from "../../ledger.repository.ts";
import { UpgradeRunnerRepository } from "../../runner/runner-ledger.repository.ts";
import { defineMigrationStep, type MigrationStepRun } from "../../step/migration-step.ts";
import { BackgroundStepsService } from "../background-steps.service.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
const STEP = "identity:reopen-unproven-accounts";
const IDENTITY = { owner: "worker-1", image: "3.21.0", host: "test-host" };

let sequence = 0;
let scratch: { name: string; admin: pg.Pool; postgres: pg.Pool };

beforeEach(async () => {
  if (!DB_URL) return;
  const name = `background_steps_${Date.now().toString(36)}_${sequence++}`;
  const admin = new pg.Pool({ connectionString: DB_URL, max: 1 });
  await admin.query(`CREATE SCHEMA "${name}"`);
  const postgres = new pg.Pool({
    connectionString: DB_URL,
    max: 2,
    options: `-c search_path=${name},${name}_upgrade_ledger`,
  });
  await createLedgerTables({ postgres });
  scratch = { name, admin, postgres };
});

afterEach(async () => {
  if (!DB_URL) return;
  await scratch.postgres.end();
  await scratch.admin.query(
    `DROP SCHEMA IF EXISTS "${scratch.name}_upgrade_ledger", "${scratch.name}" CASCADE`,
  );
  await scratch.admin.end();
});

async function recordStep({
  status,
  report = null,
}: {
  status: "pending" | "running";
  report?: Record<string, unknown> | null;
}): Promise<void> {
  await scratch.postgres.query(
    `INSERT INTO "_langwatch_upgrade_step" ("id", "kind", "mode", "status", "report", "updated_at")
     VALUES ($1, 'data', 'background', $2, $3::jsonb, now())`,
    [STEP, status, report === null ? null : JSON.stringify(report)],
  );
}

async function stepRow(): Promise<{ status: string; report: unknown; last_error: string | null }> {
  const { rows } = await scratch.postgres.query(
    `SELECT "status", "report", "last_error" FROM "_langwatch_upgrade_step" WHERE "id" = $1`,
    [STEP],
  );
  return rows[0];
}

function serviceOver({
  run,
  needsOldWritersGone = false,
  oldWritersGone = true,
  warnings = [],
}: {
  run: MigrationStepRun;
  needsOldWritersGone?: boolean;
  oldWritersGone?: boolean;
  warnings?: Record<string, unknown>[];
}) {
  const ledger = UpgradeLedgerRepository.create({ postgres: scratch.postgres });
  const runner = UpgradeRunnerRepository.create({ postgres: scratch.postgres });
  const step = defineMigrationStep({
    id: STEP,
    kind: "data",
    mode: "background",
    description: "Reopens accounts that never proved their address.",
    needsOldWritersGone,
    run,
  });
  return BackgroundStepsService.create({
    ledger: {
      findSteps: () => ledger.findSteps(),
      acquireLease: (input) => ledger.acquireLease(input),
      renewLease: (input) => ledger.renewLease(input),
      releaseLease: (input) => ledger.releaseLease(input),
      markRunning: (input) => runner.markRunning(input),
      setStatus: (input) => runner.setStatus(input),
      saveReport: (input) => runner.saveReport(input),
    },
    steps: [step],
    serving: () => true,
    oldWritersGoneFor: async () => oldWritersGone,
    identity: IDENTITY,
    retry: { attempts: 1, firstBackoffMs: 1, maxBackoffMs: 1 },
    log: (level, _message, fields) => {
      if (level === "warn") warnings.push(fields);
    },
  });
}

const sweep = (service: BackgroundStepsService) =>
  service.sweep({ signal: new AbortController().signal });

describe.skipIf(!DB_URL)("BackgroundStepsService over a ledger", () => {
  describe("given a pending background step", () => {
    /** @scenario "A pending background step runs on the worker and is recorded done" */
    it("runs it once and records it done with its report", async () => {
      await recordStep({ status: "pending" });
      let runs = 0;
      const service = serviceOver({
        run: async ({ checkpoint }) => {
          runs++;
          await checkpoint.save({ report: { reopened: 1 } });
          return { reopened: 2 };
        },
      });

      expect(await sweep(service)).toMatchObject({ ran: [STEP], failed: [] });
      expect(await sweep(service)).toMatchObject({ ran: [] });

      expect(runs).toBe(1);
      expect(await stepRow()).toMatchObject({ status: "done", report: { reopened: 2 } });
    });
  });

  describe("given a step a dead worker left running with a checkpoint", () => {
    /** @scenario "A step left running by a dead worker resumes from its checkpoint" */
    it("resumes it from that checkpoint", async () => {
      await recordStep({ status: "running", report: { cursor: "c-42" } });
      let resumedFrom: unknown;
      const service = serviceOver({
        run: async ({ checkpoint }) => {
          resumedFrom = checkpoint.resumeFrom;
          return { done: true };
        },
      });

      await sweep(service);

      expect(resumedFrom).toEqual({ cursor: "c-42" });
      expect(await stepRow()).toMatchObject({ status: "done" });
    });
  });

  describe("given another worker holds the step's lease", () => {
    /** @scenario "A step another worker holds is skipped" */
    it("does not run it and leaves it pending", async () => {
      await recordStep({ status: "pending" });
      const ledger = UpgradeLedgerRepository.create({ postgres: scratch.postgres });
      await ledger.acquireLease({
        name: `background:${STEP}`,
        owner: "worker-2",
        image: "3.21.0",
        host: "other-host",
        ttlMs: 60_000,
      });
      let runs = 0;
      const service = serviceOver({ run: async () => ({ runs: ++runs }) });

      expect(await sweep(service)).toMatchObject({ ran: [], failed: [] });

      expect(runs).toBe(0);
      expect(await stepRow()).toMatchObject({ status: "pending" });
    });
  });

  describe("given a step whose run throws", () => {
    /** @scenario "A failing background step is recorded failed, naming its module" */
    it("records it failed with the error and names the step and its module", async () => {
      await recordStep({ status: "pending" });
      const warnings: Record<string, unknown>[] = [];
      const service = serviceOver({
        run: async () => {
          throw new Error("identity store unreachable");
        },
        warnings,
      });

      expect(await sweep(service)).toMatchObject({ failed: [STEP] });

      expect(await stepRow()).toMatchObject({
        status: "failed",
        last_error: "identity store unreachable",
      });
      expect(warnings).toContainEqual(expect.objectContaining({ step: STEP, module: "identity" }));
    });
  });

  describe("given a step that needs old writers gone while one is live", () => {
    /** @scenario "A step that needs old writers gone waits while an old writer is live" */
    it("does not run it and reports it waiting", async () => {
      await recordStep({ status: "pending" });
      let runs = 0;
      const service = serviceOver({
        run: async () => ({ runs: ++runs }),
        needsOldWritersGone: true,
        oldWritersGone: false,
      });

      expect(await sweep(service)).toMatchObject({ ran: [], waiting: [STEP] });
      expect(runs).toBe(0);
      expect(await stepRow()).toMatchObject({ status: "pending" });
    });
  });
});

/**
 * @vitest-environment node
 * @see specs/upgrade/upgrade-reader.feature
 * Requires LANGWATCH_TEST_DATABASE_URL; every test gets its own Postgres schema holding only the
 * ledger tables, so the shared test database is never touched and no other table is readable.
 */
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createLedgerTables, LEDGER_TABLE } from "../../ledger-tables.ts";
import type { UpgradeImage } from "../reader.schema.ts";
import { UpgradeReadError, type UpgradeReader, createUpgradeReader } from "../reader.service.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

let sequence = 0;
const scratchName = () => `upgrade_reader_${Date.now().toString(36)}_${sequence++}`;

const widen = ({ ledger }: { ledger: string }) => [
  `ALTER TABLE "${ledger}"."_langwatch_upgrade_step" ADD COLUMN IF NOT EXISTS "owner" TEXT`,
  `ALTER TABLE "${ledger}"."_langwatch_upgrade_step" ADD COLUMN IF NOT EXISTS "description" TEXT`,
  `ALTER TABLE "${ledger}"."_langwatch_upgrade_run" ADD COLUMN IF NOT EXISTS "floor" TEXT`,
  `CREATE TABLE IF NOT EXISTS "${ledger}"."_langwatch_upgrade_target" (
    "step_id" TEXT NOT NULL, "target" TEXT NOT NULL, "status" TEXT NOT NULL, "version" TEXT,
    "last_error" TEXT, "updated_at" TIMESTAMP(3) NOT NULL, PRIMARY KEY ("step_id", "target"))`,
  `CREATE TABLE IF NOT EXISTS "${ledger}"."_langwatch_upgrade_lease" (
    "name" TEXT NOT NULL PRIMARY KEY, "owner" TEXT NOT NULL, "image" TEXT NOT NULL,
    "host" TEXT NOT NULL, "heartbeat_at" TIMESTAMP(3) NOT NULL, "expires_at" TIMESTAMP(3) NOT NULL)`,
];

interface Scratch {
  postgres: Pool;
  ledgerSchema: string;
  widen(): Promise<void>;
  drop(): Promise<void>;
}

async function openScratch(): Promise<Scratch> {
  const name = scratchName();
  const admin = new Pool({ connectionString: DB_URL, max: 1 });
  await admin.query(`CREATE SCHEMA "${name}"`);
  const postgres = new Pool({
    connectionString: DB_URL,
    max: 3,
    options: `-c search_path=${name},${name}_upgrade_ledger`,
  });
  await createLedgerTables({ postgres });
  for (const table of [LEDGER_TABLE.target, LEDGER_TABLE.lease, LEDGER_TABLE.roster]) {
    await postgres.query(`DROP TABLE IF EXISTS "${name}_upgrade_ledger"."${table}"`);
  }
  const ledgerSchema = `${name}_upgrade_ledger`;
  return {
    postgres,
    ledgerSchema,
    widen: async () => {
      for (const statement of widen({ ledger: ledgerSchema })) await postgres.query(statement);
    },
    drop: async () => {
      await postgres.end();
      await admin.query(`DROP SCHEMA IF EXISTS "${name}_upgrade_ledger", "${name}" CASCADE`);
      await admin.end();
    },
  };
}

const IMAGE: UpgradeImage = { release: "3.21.0", steps: [] };
const FLOOR = { release: "3.20.1" };

function readerOver({
  scratch,
  image = IMAGE,
}: {
  scratch: Scratch;
  image?: UpgradeImage;
}): UpgradeReader {
  return createUpgradeReader({ postgres: scratch.postgres, image, floor: FLOOR });
}

const insertLease = ({ scratch, offset }: { scratch: Scratch; offset: string }) =>
  scratch.postgres.query(
    `INSERT INTO "_langwatch_upgrade_lease"
     VALUES ('upgrade', 'runner-1', '3.21.0', 'pre-roll',
             (now() AT TIME ZONE 'UTC') - interval '10 minutes',
             (now() AT TIME ZONE 'UTC') + $1::interval)`,
    [offset],
  );

async function insertRun({
  scratch,
  id,
  kind = "upgrade",
  release,
  startedAt,
  outcome = "succeeded",
  finished = true,
  floor,
  plan,
  report,
}: {
  scratch: Scratch;
  id: string;
  kind?: string;
  release: string | null;
  startedAt: string;
  outcome?: string | null;
  finished?: boolean;
  floor?: string;
  plan?: object;
  report?: object;
}) {
  await scratch.postgres.query(
    `INSERT INTO "_langwatch_upgrade_run" ("id", "kind", "release", "started_at", "finished_at", "outcome", "plan", "report")
     VALUES ($1, $2, $3, $4::timestamp, $5::timestamp, $6, $7::jsonb, $8::jsonb)`,
    [
      id,
      kind,
      release,
      startedAt,
      finished ? startedAt : null,
      finished ? outcome : null,
      plan ? JSON.stringify(plan) : null,
      report ? JSON.stringify(report) : null,
    ],
  );
  if (floor) {
    await scratch.postgres.query(
      `UPDATE "_langwatch_upgrade_run" SET "floor" = $2 WHERE "id" = $1`,
      [id, floor],
    );
  }
}

async function insertStep({
  scratch,
  id,
  kind = "data",
  release = null,
  mode = "blocking",
  status = "done",
  runId = null,
  inferred = false,
}: {
  scratch: Scratch;
  id: string;
  kind?: string;
  release?: string | null;
  mode?: string;
  status?: string;
  runId?: string | null;
  inferred?: boolean;
}) {
  await scratch.postgres.query(
    `INSERT INTO "_langwatch_upgrade_step" ("id", "kind", "release", "mode", "status", "run_id", "inferred", "updated_at")
     VALUES ($1, $2, $3, $4, $5, $6, $7, (now() AT TIME ZONE 'UTC'))`,
    [id, kind, release, mode, status, runId, inferred],
  );
}

describe.skipIf(!DB_URL)("UpgradeReader over the ledger tables", () => {
  let scratch: Scratch;
  beforeEach(async () => {
    scratch = await openScratch();
  });
  afterEach(async () => {
    await scratch.drop();
  });

  describe("when the status is read", () => {
    /** @scenario "An empty ledger reads as no upgrade recorded yet" */
    it("reads an empty ledger as never upgraded", async () => {
      const status = await readerOver({ scratch }).status();
      expect(status).toMatchObject({
        state: "never-upgraded",
        reason: "no-upgrade-recorded",
        installed: null,
        origin: "none",
        lastRun: null,
        counts: {},
      });
      expect(status.summary).toContain("No upgrade recorded yet");
    });

    /** @scenario "A database without the ledger tables reads as no upgrade recorded yet" */
    it("reads a database without the ledger tables as no upgrade recorded", async () => {
      await scratch.postgres.query(`DROP TABLE "_langwatch_upgrade_step"`);
      await scratch.postgres.query(`DROP TABLE "_langwatch_upgrade_run"`);
      const reader = readerOver({ scratch });
      expect(await reader.status()).toMatchObject({
        state: "never-upgraded",
        reason: "no-upgrade-recorded",
      });
      expect((await reader.listSteps()).items).toEqual([]);
      expect((await reader.listRuns()).items).toEqual([]);
    });

    /** @scenario "The status carries the installed release, the origin and the last run" */
    it("carries the installed release, the origin and the newest run", async () => {
      await insertRun({
        scratch,
        id: "run_seed",
        kind: "seed",
        release: "3.19.0",
        startedAt: "2026-10-01 10:00:00",
      });
      await insertRun({
        scratch,
        id: "run_up",
        release: "3.21.0",
        startedAt: "2026-10-05 10:00:00",
      });
      await insertStep({
        scratch,
        id: "prisma:1",
        status: "done",
        release: "3.21.0",
        runId: "run_up",
      });
      const status = await readerOver({ scratch }).status();
      expect(status).toMatchObject({
        state: "up-to-date",
        installed: "3.21.0",
        origin: "recorded",
        counts: { done: 1 },
      });
      expect(status.lastRun?.id).toBe("run_up");
      expect(status.lastRun?.startedAt).toBe("2026-10-05T10:00:00Z");
    });

    /** @scenario "A release known only from a seed is marked inferred" */
    it("marks a release known only from a seed as inferred", async () => {
      await insertRun({
        scratch,
        id: "run_seed",
        kind: "seed",
        release: "3.21.0",
        startedAt: "2026-10-01 10:00:00",
      });
      const status = await readerOver({ scratch }).status();
      expect(status).toMatchObject({ installed: "3.21.0", origin: "inferred" });
    });

    /** @scenario "An unknown step status is shown raw" */
    it("shows an unknown step status raw and does not throw", async () => {
      await insertRun({
        scratch,
        id: "run_up",
        release: "3.21.0",
        startedAt: "2026-10-05 10:00:00",
      });
      await insertStep({ scratch, id: "app:odd", status: "quarantined", mode: "background" });
      const reader = readerOver({ scratch });
      const status = await reader.status();
      expect(status.counts).toEqual({ quarantined: 1 });
      expect(status.state).toBe("up-to-date");
      const { items } = await reader.listSteps();
      expect(items[0]).toMatchObject({ status: "quarantined", statusLabel: "quarantined" });
    });

    /** @scenario "An unexpired lease reads as upgrading and names its holder" */
    it("reads an unexpired lease as upgrading and names its holder", async () => {
      await scratch.widen();
      await insertRun({
        scratch,
        id: "run_up",
        release: "3.20.1",
        startedAt: "2026-10-05 10:00:00",
      });
      await insertLease({ scratch, offset: "5 minutes" });
      const reader = readerOver({ scratch });
      const status = await reader.status();
      expect(status.state).toBe("upgrading");
      expect(status.lease).toMatchObject({ owner: "runner-1", image: "3.21.0", host: "pre-roll" });
    });

    /** @scenario "An expired lease does not read as upgrading" */
    it("does not read an expired lease as upgrading", async () => {
      await scratch.widen();
      await insertRun({
        scratch,
        id: "run_up",
        release: "3.21.0",
        startedAt: "2026-10-05 10:00:00",
      });
      await insertLease({ scratch, offset: "-1 minute" });
      const reader = readerOver({ scratch });
      const status = await reader.status();
      expect(status.state).toBe("up-to-date");
      expect(status.lease).toBeNull();
    });

    it("reads an unfinished upgrade run as upgrading while no lease table exists", async () => {
      await insertRun({
        scratch,
        id: "run_up",
        release: "3.21.0",
        startedAt: "2026-10-05 10:00:00",
        finished: false,
      });
      expect((await readerOver({ scratch }).status()).state).toBe("upgrading");
    });

    /** @scenario "A failed target reads as needs attention" */
    it("reads a failed target as needs attention", async () => {
      await scratch.widen();
      await insertRun({
        scratch,
        id: "run_up",
        release: "3.21.0",
        startedAt: "2026-10-05 10:00:00",
      });
      await insertStep({
        scratch,
        id: "clickhouse:00001",
        kind: "clickhouse-schema",
        status: "done",
      });
      await scratch.postgres.query(
        `INSERT INTO "_langwatch_upgrade_target" VALUES ('clickhouse:00001', 'dataplane-2', 'failed', NULL, 'refused', now() AT TIME ZONE 'UTC')`,
      );
      const status = await readerOver({ scratch }).status();
      expect(status).toMatchObject({
        state: "needs-attention",
        reason: "failed-target",
        failedTargets: 1,
      });
    });

    /** @scenario "An image below the floor the ledger recorded reads as unsupported" */
    it("reads an image below the floor a run recorded as unsupported", async () => {
      await scratch.widen();
      await insertRun({
        scratch,
        id: "run_up",
        release: "3.21.0",
        startedAt: "2026-10-05 10:00:00",
        floor: "3.20.1",
      });
      const reader = readerOver({ scratch, image: { release: "3.19.0", steps: [] } });
      expect(await reader.status()).toMatchObject({
        state: "unsupported",
        reason: "image-below-ledger-floor",
        ledgerFloor: "3.20.1",
      });
    });
  });

  describe("when steps and releases are read", () => {
    async function seedSteps() {
      await insertRun({
        scratch,
        id: "run_up",
        release: "3.21.0",
        startedAt: "2026-10-05 10:00:00",
      });
      await insertStep({
        scratch,
        id: "prisma:1",
        release: "3.20.1",
        status: "done",
        runId: "run_up",
      });
      await insertStep({
        scratch,
        id: "app:backfill",
        release: "3.21.0",
        mode: "background",
        status: "pending",
        runId: "run_up",
      });
      await insertStep({
        scratch,
        id: "app:tenants",
        kind: "tenant",
        release: "3.21.0",
        mode: "background",
        status: "failed",
      });
      await insertStep({
        scratch,
        id: "app:later",
        release: "3.21.0",
        mode: "operator",
        status: "gated",
      });
    }

    /** @scenario "Steps are listed with the filters of release, mode and status" */
    it("filters steps by release, mode and status", async () => {
      await seedSteps();
      const reader = readerOver({ scratch });
      const ids = async (filter: Parameters<UpgradeReader["listSteps"]>[0]) =>
        (await reader.listSteps(filter)).items.map((step) => step.id);
      expect(await ids({ release: "3.20.1" })).toEqual(["prisma:1"]);
      expect(await ids({ mode: "background" })).toEqual(["app:backfill", "app:tenants"]);
      expect(await ids({ status: "gated" })).toEqual(["app:later"]);
      expect(await ids({ release: "3.21.0", mode: "background", status: "failed" })).toEqual([
        "app:tenants",
      ]);
      expect(await ids({})).toHaveLength(4);
    });

    /** @scenario "An unknown step kind and mode are passed through" */
    it("passes an unknown kind and mode through", async () => {
      await insertStep({ scratch, id: "app:odd", kind: "reindex", mode: "deferred" });
      const { items } = await readerOver({ scratch }).listSteps();
      expect(items[0]).toMatchObject({ kind: "reindex", mode: "deferred" });
    });

    /** @scenario "A step the image declares but the ledger lacks is listed as waiting and not recorded" */
    it("lists an image step the ledger lacks as waiting and not recorded", async () => {
      await insertStep({ scratch, id: "prisma:1", release: "3.20.1" });
      const image: UpgradeImage = {
        release: "3.21.0",
        steps: [
          {
            id: "prisma:1",
            kind: "postgres-schema",
            mode: "blocking",
            owner: "ops",
            description: "ledger",
          },
          { id: "prisma:2", kind: "postgres-schema", mode: "blocking", description: "next" },
        ],
      };
      const { items } = await readerOver({ scratch, image }).listSteps();
      expect(items.find((step) => step.id === "prisma:2")).toMatchObject({
        status: "pending",
        statusLabel: "Waiting",
        recorded: false,
        release: "3.21.0",
        description: "next",
      });
      expect(items.find((step) => step.id === "prisma:1")).toMatchObject({
        recorded: true,
        owner: "ops",
      });
    });

    /** @scenario "Releases are listed newest first with their step counts" */
    it("lists releases newest first with counts and marks the image", async () => {
      await seedSteps();
      await insertStep({ scratch, id: "prisma:0", release: "3.9.0" });
      const { items } = await readerOver({
        scratch,
        image: { release: "3.22.0", steps: [] },
      }).listReleases();
      expect(items.map((release) => release.release)).toEqual([
        "3.22.0",
        "3.21.0",
        "3.20.1",
        "3.9.0",
      ]);
      expect(items[0]).toMatchObject({ image: true, installed: false, stepCount: 0 });
      expect(items[1]).toMatchObject({
        installed: true,
        stepCount: 3,
        counts: { pending: 1, failed: 1, gated: 1 },
      });
    });

    /** @scenario "A step lists no targets before the target table exists" */
    it("lists no targets before the target table exists", async () => {
      await insertStep({ scratch, id: "clickhouse:00001", kind: "clickhouse-schema" });
      const step = await readerOver({ scratch }).getStep({ id: "clickhouse:00001" });
      expect(step.targets).toEqual([]);
    });

    /** @scenario "A step lists its targets once the target table exists" */
    it("lists a step's targets once the target table exists", async () => {
      await scratch.widen();
      await insertStep({ scratch, id: "clickhouse:00001", kind: "clickhouse-schema" });
      await scratch.postgres.query(
        `INSERT INTO "_langwatch_upgrade_target" VALUES
           ('clickhouse:00001', 'dataplane-1', 'done', '00001', NULL, now() AT TIME ZONE 'UTC'),
           ('clickhouse:00001', 'dataplane-2', 'failed', NULL, 'refused', now() AT TIME ZONE 'UTC')`,
      );
      const step = await readerOver({ scratch }).getStep({ id: "clickhouse:00001" });
      expect(step.targets).toMatchObject([
        { target: "dataplane-1", status: "done", version: "00001", lastError: null },
        { target: "dataplane-2", status: "failed", version: null, lastError: "refused" },
      ]);
    });

    /** @scenario "Reading a step or a run that does not exist is refused by code" */
    it("refuses an unknown step and an unknown run by code", async () => {
      const reader = readerOver({ scratch });
      await expect(reader.getStep({ id: "app:missing" })).rejects.toMatchObject({
        code: "upgrade_not_found",
      });
      await expect(reader.getRun({ id: "run_missing" })).rejects.toMatchObject({
        code: "upgrade_not_found",
        isHandled: true,
        httpStatus: 404,
      });
      await expect(reader.getRun({ id: "run_missing" })).rejects.toBeInstanceOf(UpgradeReadError);
    });
  });

  describe("when runs are read", () => {
    async function seedRuns() {
      for (let index = 1; index <= 5; index++) {
        await insertRun({
          scratch,
          id: `run_${index}`,
          release: "3.21.0",
          startedAt: `2026-10-0${index} 10:00:00`,
        });
      }
    }

    /** @scenario "Runs are listed newest first in pages" */
    it("lists runs newest first in pages following the cursor", async () => {
      await seedRuns();
      const reader = readerOver({ scratch });
      const first = await reader.listRuns({ limit: 2 });
      const second = await reader.listRuns({ limit: 2, cursor: first.cursor });
      const third = await reader.listRuns({ limit: 2, cursor: second.cursor });
      expect(first.items.map((run) => run.id)).toEqual(["run_5", "run_4"]);
      expect(second.items.map((run) => run.id)).toEqual(["run_3", "run_2"]);
      expect(third.items.map((run) => run.id)).toEqual(["run_1"]);
      expect(third.cursor).toBeNull();
    });

    /** @scenario "A malformed cursor is refused by code" */
    it("refuses a cursor the reader did not issue", async () => {
      await expect(
        readerOver({ scratch }).listRuns({ cursor: "not-a-cursor" }),
      ).rejects.toMatchObject({
        code: "upgrade_invalid_cursor",
        isHandled: true,
        httpStatus: 400,
      });
    });

    /** @scenario "A run is read with its plan, its report and the steps it recorded" */
    it("reads a run with its plan, its report and its steps", async () => {
      await insertRun({
        scratch,
        id: "run_up",
        release: "3.21.0",
        startedAt: "2026-10-05 10:00:00",
        plan: { steps: 2 },
        report: { took: "3s" },
      });
      await insertStep({ scratch, id: "prisma:1", runId: "run_up" });
      await insertStep({ scratch, id: "prisma:2", runId: "run_up" });
      await insertStep({ scratch, id: "prisma:3", runId: "run_other" });
      const run = await readerOver({ scratch }).getRun({ id: "run_up" });
      expect(run).toMatchObject({ id: "run_up", plan: { steps: 2 }, report: { took: "3s" } });
      expect(run.steps.map((step) => step.id)).toEqual(["prisma:1", "prisma:2"]);
    });

    /** @scenario "A run's phases are read from its report" */
    it("reads a run's phases from its report in the order written", async () => {
      const at = (minute: number) => `2026-10-05T10:0${minute}:00.000Z`;
      const phases = [
        { name: "preflight", startedAt: at(0), finishedAt: at(1), outcome: "succeeded" },
        {
          name: "postgres-schema",
          release: "3.21.0",
          startedAt: at(1),
          finishedAt: at(2),
          outcome: "succeeded",
        },
        { name: "reconcile", startedAt: at(2), outcome: "running" },
      ];
      await insertRun({
        scratch,
        id: "run_phased",
        release: "3.21.0",
        startedAt: "2026-10-05 10:00:00",
        report: { phases },
      });
      const run = await readerOver({ scratch }).getRun({ id: "run_phased" });
      expect(run.phases).toEqual([
        { ...phases[0], release: null },
        phases[1],
        { ...phases[2], release: null, finishedAt: null },
      ]);
    });
  });

  /** @scenario "Every read is answered from a schema holding only the ledger tables" */
  it("answers every read from a schema holding only the ledger tables", async () => {
    const reader = readerOver({ scratch });
    await insertRun({ scratch, id: "run_up", release: "3.21.0", startedAt: "2026-10-05 10:00:00" });
    await insertStep({ scratch, id: "prisma:1", release: "3.21.0", runId: "run_up" });
    const { rows } = await scratch.postgres.query<{ name: string }>(
      `SELECT table_name AS name FROM information_schema.tables WHERE table_schema = $1`,
      [scratch.ledgerSchema],
    );
    expect(rows.map((row) => row.name).toSorted()).toEqual([
      "_langwatch_upgrade_run",
      "_langwatch_upgrade_step",
    ]);
    await expect(reader.status()).resolves.toBeDefined();
    await expect(reader.listReleases()).resolves.toBeDefined();
    await expect(reader.listSteps()).resolves.toBeDefined();
    await expect(reader.listRuns()).resolves.toBeDefined();
    await expect(reader.getRun({ id: "run_up" })).resolves.toBeDefined();
  });

  describe("when the ledger targets are listed", () => {
    it("rolls each target up from one summed read", async () => {
      await scratch.widen();
      await scratch.postgres.query(
        `INSERT INTO "_langwatch_upgrade_target"
           ("step_id", "target", "status", "version", "last_error", "updated_at") VALUES
           ('clickhouse:00001', 'eu', 'done', '1', NULL, '2026-10-01T00:00:00Z'),
           ('clickhouse:00002', 'eu', 'failed', NULL, 'boom', '2026-10-02T00:00:00Z'),
           ('clickhouse:00001', 'us', 'done', '1', NULL, '2026-10-01T00:00:00Z')`,
      );
      await expect(readerOver({ scratch }).listTargets()).resolves.toEqual([
        { target: "eu", version: "1", outstanding: 1, lastError: "boom" },
        { target: "us", version: "1", outstanding: 0, lastError: null },
      ]);
    });

    it("lists none when the ledger has no target table", async () => {
      await expect(readerOver({ scratch }).listTargets()).resolves.toEqual([]);
    });
  });

  describe("when an upgrade is previewed", () => {
    it("plans an empty ledger as a fresh install and shows the preflight", async () => {
      const preview = await createUpgradeReader({
        postgres: scratch.postgres,
        image: IMAGE,
        floor: FLOOR,
        planning: {
          image: { release: "3.21.0", steps: [] },
          releases: { manifests: [], floor: { release: "3.20.1", namedAt: "2026-09-01" } },
        },
      }).preview({ to: "3.21.0" });
      expect(preview.installed).toBeNull();
      expect(preview.plan.outcome).toBe("planned");
      expect(preview.preflight.map((row) => row.id)).toContain("floor");
    });
  });
});

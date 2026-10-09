/**
 * `servingUpgradeGate`'s seam over a real Postgres: each test gets its own schema. Requires
 * LANGWATCH_TEST_DATABASE_URL. Spec: specs/upgrade/entry-points.feature.
 */
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createLedgerTables } from "../../ledger-tables.ts";
import type { ReleaseTreeSteps } from "../../manifest/stamp.ts";
import type { FirstInstallUpgrade } from "../first-install-upgrade.ts";
import { readImageCodeSteps } from "../image-code-steps.ts";
import { UPGRADE_COMMAND } from "../serving-gate.ts";
import { gatePoolConfig, upgradeGateOver } from "../serving-upgrade-gate.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
const PRISMA_FOLDER = "20261006180000_add_column";
const PRISMA = `prisma:${PRISMA_FOLDER}`;
const GOOSE = "clickhouse:00042";
const TREE: ReleaseTreeSteps = {
  prismaFolders: [PRISMA_FOLDER],
  gooseFiles: ["00042_add_column.sql"],
  codeSteps: [],
};

let sequence = 0;
let scratch: { name: string; admin: pg.Pool; postgres: pg.Pool; closed: boolean };

beforeEach(async () => {
  const name = `serving_gate_${Date.now().toString(36)}_${sequence++}`;
  const admin = new pg.Pool({ connectionString: DB_URL, max: 1 });
  await admin.query(`CREATE SCHEMA "${name}"`);
  const postgres = new pg.Pool({
    connectionString: DB_URL,
    max: 1,
    options: `-c search_path=${name},${name}_upgrade_ledger`,
  });
  scratch = { name, admin, postgres, closed: false };
});

afterEach(async () => {
  if (!scratch.closed) await scratch.postgres.end();
  await scratch.admin.query(
    `DROP SCHEMA IF EXISTS "${scratch.name}_upgrade_ledger", "${scratch.name}" CASCADE`,
  );
  await scratch.admin.end();
});

const KIND_BY_PREFIX: Record<string, string> = {
  prisma: "postgres-schema",
  clickhouse: "clickhouse-schema",
};
const kindOf = (id: string) => KIND_BY_PREFIX[id.slice(0, id.indexOf(":"))] ?? "data";

async function recordSteps(steps: Record<string, "done" | "pending">): Promise<void> {
  const { postgres } = scratch;
  await postgres.query(`CREATE TABLE "_prisma_migrations" ("migration_name" TEXT NOT NULL)`);
  await createLedgerTables({ postgres });
  for (const [id, status] of Object.entries(steps)) {
    await postgres.query(
      `INSERT INTO "_langwatch_upgrade_step" ("id", "kind", "mode", "status", "updated_at")
       VALUES ($1, $2, 'blocking', $3, now())`,
      [id, kindOf(id), status],
    );
  }
}

function gateFor({
  role,
  withClickHouse = true,
  firstInstall = async () => ({ exitCode: 0, logTail: [] }),
  tree = TREE,
}: {
  role: "api" | "worker";
  withClickHouse?: boolean;
  firstInstall?: FirstInstallUpgrade;
  tree?: ReleaseTreeSteps;
}) {
  return upgradeGateOver({
    role,
    postgres: scratch.postgres,
    close: async () => {
      scratch.closed = true;
      await scratch.postgres.end();
    },
    tree,
    release: null,
    withClickHouse,
    processId: `test:${role}`,
    firstInstall,
  });
}

describe.skipIf(!DB_URL)("servingUpgradeGate over a ledger", () => {
  describe("given a blocking step of this image still pending", () => {
    /** @scenario "A serving process refuses by name when its installation is behind" */
    it("refuses the worker by name and closes its connection", async () => {
      await recordSteps({ [PRISMA]: "done", [GOOSE]: "pending" });

      const verdict = await gateFor({ role: "worker" }).admit();

      expect(verdict).toMatchObject({ admitted: false, outcome: "behind", outstanding: [GOOSE] });
      expect(verdict.admitted ? "" : verdict.refusal).toContain(UPGRADE_COMMAND);
      expect(scratch.closed).toBe(true);
    });
  });

  describe("given a blocking step of this image still pending, for the api", () => {
    /** @scenario "The api on an installation behind its image runs the upgrade once, then serves" */
    it("runs the upgrade once for the api and admits it after", async () => {
      await recordSteps({ [PRISMA]: "done", [GOOSE]: "pending" });
      let runs = 0;
      const gate = gateFor({
        role: "api",
        firstInstall: async () => {
          runs += 1;
          await scratch.postgres.query(
            `UPDATE "_langwatch_upgrade_step" SET "status" = 'done' WHERE "id" = $1`,
            [GOOSE],
          );
          return { exitCode: 0, logTail: [] };
        },
      });

      await expect(gate.admit()).resolves.toMatchObject({ admitted: true });
      expect(runs).toBe(1);
      await gate.release();
    });

    /** @scenario "The worker never runs the upgrade when its installation is behind" */
    it("refuses the worker by name and runs nothing", async () => {
      await recordSteps({ [PRISMA]: "done", [GOOSE]: "pending" });
      let runs = 0;
      const verdict = await gateFor({
        role: "worker",
        firstInstall: async () => {
          runs += 1;
          return { exitCode: 0, logTail: [] };
        },
      }).admit();

      expect(verdict).toMatchObject({ admitted: false, outcome: "behind" });
      expect(verdict.admitted ? "" : verdict.refusal).toContain(UPGRADE_COMMAND);
      expect(runs).toBe(0);
    });
  });

  describe("given every blocking step done", () => {
    /** @scenario "A serving process is admitted once the upgrade has run" */
    it("admits the api and records its roster entry until release", async () => {
      await recordSteps({ [PRISMA]: "done", [GOOSE]: "done" });
      const gate = gateFor({ role: "api" });

      await expect(gate.admit()).resolves.toMatchObject({ admitted: true });
      const { rows } = await scratch.postgres.query(
        `SELECT "process_id" FROM "_langwatch_serving_roster"`,
      );
      expect(rows).toEqual([{ process_id: "test:api" }]);

      await gate.release();
      expect(scratch.closed).toBe(true);
    });
  });

  describe("given a DATABASE_URL that names the ledger's schema with ?schema=", () => {
    /** @scenario "The gate reads the ledger in the schema DATABASE_URL names" */
    it("connects in that schema and admits the api", async () => {
      await recordSteps({ [PRISMA]: "done", [GOOSE]: "done" });
      const url = new URL(DB_URL ?? "");
      url.searchParams.set("schema", scratch.name);
      const postgres = new pg.Pool(gatePoolConfig({ databaseUrl: url.toString() }));
      const gate = upgradeGateOver({
        role: "api",
        postgres,
        close: () => postgres.end(),
        tree: TREE,
        release: null,
        withClickHouse: true,
        processId: "test:api",
        firstInstall: async () => ({ exitCode: 1, logTail: [] }),
      });

      await expect(gate.admit()).resolves.toMatchObject({ admitted: true });
      await gate.release();
    });
  });

  describe("given an empty ledger on an empty schema", () => {
    /** @scenario "The api's first boot on an empty installation runs the upgrade once" */
    it("runs the upgrade once for the api and admits it after", async () => {
      let runs = 0;
      const gate = gateFor({
        role: "api",
        firstInstall: async () => {
          runs += 1;
          await recordSteps({ [PRISMA]: "done", [GOOSE]: "done" });
          return { exitCode: 0, logTail: [] };
        },
      });

      await expect(gate.admit()).resolves.toMatchObject({ admitted: true });
      expect(runs).toBe(1);
      await gate.release();
    });

    /** @scenario "The api refuses a first install whose upgrade failed" */
    it("refuses the api with the command and the exit code when the upgrade failed", async () => {
      const verdict = await gateFor({
        role: "api",
        firstInstall: async () => ({ exitCode: 3, logTail: [] }),
      }).admit();

      expect(verdict).toMatchObject({ admitted: false, outcome: "first-install" });
      expect(verdict.admitted ? "" : verdict.refusal).toContain(UPGRADE_COMMAND);
      expect(verdict.admitted ? "" : verdict.refusal).toContain("exited 3");
      expect(verdict).toMatchObject({ failedRun: { failedSteps: [], logTail: [] } });
      expect(scratch.closed).toBe(false);
    });

    /** @scenario "The worker never runs the upgrade on a first install" */
    it("refuses the worker and runs nothing", async () => {
      let runs = 0;
      const verdict = await gateFor({
        role: "worker",
        firstInstall: async () => {
          runs += 1;
          return { exitCode: 0, logTail: [] };
        },
      }).admit();

      expect(verdict).toMatchObject({ admitted: false, outcome: "behind" });
      expect(verdict.admitted ? "" : verdict.refusal).toContain(UPGRADE_COMMAND);
      expect(runs).toBe(0);
    });
  });

  describe("given the image's committed code step list", () => {
    const codeSteps = readImageCodeSteps();
    const tree = { ...TREE, codeSteps };
    const blocking = codeSteps.filter((step) => step.mode === "blocking").map(({ id }) => id);
    const background = codeSteps.filter((step) => step.mode !== "blocking").map(({ id }) => id);
    const schemaDone = { [PRISMA]: "done", [GOOSE]: "done" } as const;
    const pendingOf = (ids: string[]) =>
      Object.fromEntries(ids.map((id) => [id, "pending" as const]));
    const doneOf = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, "done" as const]));

    /** @scenario "A serving process over a real ledger gates on the generated code step list" */
    it("refuses the worker naming the list's pending blocking step", async () => {
      expect(blocking.length).toBeGreaterThan(0);
      await recordSteps({ ...schemaDone, ...pendingOf(blocking) });

      const verdict = await gateFor({ role: "worker", tree }).admit();

      expect(verdict).toMatchObject({ admitted: false, outcome: "behind", outstanding: blocking });
    });

    /** @scenario "A serving process over a real ledger gates on the generated code step list" */
    it("admits the api once they are done and declares the background steps", async () => {
      await recordSteps({ ...schemaDone, ...doneOf(blocking) });
      const gate = gateFor({ role: "api", tree });

      await expect(gate.admit()).resolves.toMatchObject({ admitted: true });
      const { rows } = await scratch.postgres.query(
        `SELECT "steps" FROM "_langwatch_serving_roster"`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].steps).toEqual(expect.arrayContaining(background));

      await gate.release();
    });
  });
});

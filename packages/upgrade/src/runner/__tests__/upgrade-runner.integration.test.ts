/**
 * @vitest-environment node
 * @see specs/upgrade/upgrade-command.feature
 * Requires LANGWATCH_TEST_DATABASE_URL. Every test gets its own Postgres schema; the schema applier
 * is a fake that writes `_prisma_migrations` rows and reports ClickHouse targets as told.
 */
import { setTimeout as sleep } from "node:timers/promises";

import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createLedgerTables } from "../../ledger-tables.ts";
import { UpgradeLedgerRepository } from "../../ledger.repository.ts";
import type { ManifestStep, ReleaseManifest } from "../../manifest/manifest.ts";
import { defineMigrationStep, type MigrationStep } from "../../step/migration-step.ts";
import { UpgradeRunnerRepository } from "../runner-ledger.repository.ts";
import type {
  SchemaTargetReport,
  UpgradeReconciler,
  UpgradeSchemaApplier,
} from "../schema-applier.ts";
import { createUpgradeRunner, type UpgradeRunnerOptions } from "../upgrade-runner.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

const step = (
  id: string,
  kind: ManifestStep["kind"],
  mode: ManifestStep["mode"] = "blocking",
): ManifestStep => ({ id, kind, mode, owner: null, description: `step ${id}` });

const MANIFESTS: ReleaseManifest[] = [
  {
    release: "3.20.1",
    previous: null,
    cutAt: "2026-10-02T09:39:24+02:00",
    steps: [
      step("prisma:20261001000000_base", "postgres-schema"),
      step("clickhouse:00001", "clickhouse-schema"),
    ],
  },
  {
    release: "3.21.0",
    previous: "3.20.1",
    cutAt: "2026-10-03T09:00:00+02:00",
    steps: [
      step("prisma:20261002000000_add", "postgres-schema"),
      step("clickhouse:00002", "clickhouse-schema"),
      step("dataset:copy-keys", "data"),
      step("identity:backfill", "tenant", "background"),
    ],
  },
  {
    release: "3.22.0",
    previous: "3.21.0",
    cutAt: "2026-10-04T09:00:00+02:00",
    steps: [step("trace:reindex", "data", "background")],
  },
];
const FLOOR = { release: "3.20.1", namedAt: "2026-10-06" };

let sequence = 0;
let scratch: { name: string; postgres: Pool; admin: Pool };

beforeEach(async () => {
  const name = `upgrade_runner_${Date.now().toString(36)}_${sequence++}`;
  const admin = new Pool({ connectionString: DB_URL, max: 1 });
  await admin.query(`CREATE SCHEMA "${name}"`);
  const postgres = new Pool({
    connectionString: DB_URL,
    max: 4,
    options: `-c search_path=${name}`,
  });
  await postgres.query(`CREATE TABLE "_prisma_migrations" (
    "migration_name" TEXT NOT NULL, "logs" TEXT, "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "finished_at" TIMESTAMPTZ, "rolled_back_at" TIMESTAMPTZ)`);
  scratch = { name, postgres, admin };
});

afterEach(async () => {
  await scratch.postgres.end();
  await scratch.admin.query(`DROP SCHEMA "${scratch.name}" CASCADE`);
  await scratch.admin.end();
});

const shippedUpTo = (release: string) =>
  MANIFESTS.filter((manifest) => manifest.release <= release).flatMap((manifest) => manifest.steps);

/** Applies every shipped step up to the release asked for; `failOn` targets keep what they had. */
function fakeApplier({
  release: imageRelease,
  targets = ["shared"],
  failOn = [],
  failOnce = false,
  during,
}: {
  release: string;
  targets?: string[];
  failOn?: string[];
  failOnce?: boolean;
  during?: () => Promise<void>;
}): UpgradeSchemaApplier & { calls: (string | null)[]; order: string[] } {
  const goose = new Map(targets.map((target) => [target, new Set<string>()]));
  let pendingFailure = failOnce;
  const order: string[] = [];
  const calls: (string | null)[] = [];
  return {
    calls,
    order,
    async apply({ release }) {
      calls.push(release);
      order.push("schema");
      await during?.();
      if (pendingFailure) {
        pendingFailure = false;
        return [{ engine: "postgres", target: "postgres", ok: false, error: "connection reset" }];
      }
      const steps = shippedUpTo(release ?? imageRelease);
      for (const { id } of steps.filter((s) => s.id.startsWith("prisma:"))) {
        await scratch.postgres.query(
          `INSERT INTO "_prisma_migrations" ("migration_name", "finished_at")
           SELECT $1::text, now() WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE "migration_name" = $1::text)`,
          [id.slice("prisma:".length)],
        );
      }
      const reports: SchemaTargetReport[] = [
        { engine: "postgres", target: "postgres", ok: true, error: null },
      ];
      for (const [target, applied] of goose) {
        const failing = failOn.includes(target);
        if (!failing)
          for (const s of steps.filter((s) => s.id.startsWith("clickhouse:"))) applied.add(s.id);
        reports.push({
          engine: "clickhouse",
          target,
          ok: !failing,
          error: failing ? "Code: 210. Connection refused" : null,
          applied: new Set(applied),
        });
      }
      return reports;
    },
  };
}

function runnerFor({
  release,
  applier,
  ...overrides
}: { release: string; applier: UpgradeSchemaApplier } & Partial<UpgradeRunnerOptions>) {
  return createUpgradeRunner({
    postgres: scratch.postgres,
    image: { release, steps: shippedUpTo(release) },
    releases: { manifests: MANIFESTS, floor: FLOOR },
    applier,
    identity: { image: release, host: "pod-b" },
    log: { info: () => {}, warn: () => {} },
    lease: { ttlMs: 60_000, heartbeatMs: 10_000, waitMs: 2_000, pollMs: 50 },
    retry: { attempts: 1, backoffMs: 1 },
    ...overrides,
  });
}

const run = (runner: ReturnType<typeof createUpgradeRunner>) =>
  runner.run({ signal: new AbortController().signal });
const ledger = () => UpgradeLedgerRepository.create({ postgres: scratch.postgres });
const statusOf = async (id: string) =>
  (await ledger().findSteps()).find((s) => s.id === id)?.status;

describe.skipIf(!DB_URL)("the upgrade runner", () => {
  describe("when another runner holds a live lease", () => {
    /** @scenario "A second runner waits for the lease, then exits naming the holder" */
    it("waits up to its deadline, then exits 3 naming the holder, without applying anything", async () => {
      await createLedgerTables({ postgres: scratch.postgres });
      await ledger().acquireLease({
        name: "upgrade",
        owner: "pod-a:1",
        image: "3.20.1",
        host: "pod-a",
        ttlMs: 60_000,
      });
      const applier = fakeApplier({ release: "3.21.0" });
      const outcome = await run(
        runnerFor({
          release: "3.21.0",
          applier,
          lease: { ttlMs: 60_000, heartbeatMs: 10_000, waitMs: 300, pollMs: 50 },
        }),
      );
      expect(outcome).toMatchObject({
        exitCode: 3,
        code: "lease_not_acquired",
        detail: { holder: { owner: "pod-a:1", host: "pod-a", image: "3.20.1" } },
      });
      expect(applier.calls).toEqual([]);
    });
  });

  describe("when the holder's lease has expired", () => {
    /** @scenario "A dead holder's lease is taken over" */
    it("takes the lease over, completes, and releases it", async () => {
      await createLedgerTables({ postgres: scratch.postgres });
      await ledger().acquireLease({
        name: "upgrade",
        owner: "pod-a:1",
        image: "3.20.1",
        host: "pod-a",
        ttlMs: 1,
      });
      await sleep(20);
      const outcome = await run(
        runnerFor({ release: "3.21.0", applier: fakeApplier({ release: "3.21.0" }) }),
      );
      expect(outcome).toMatchObject({ exitCode: 0, code: "done" });
      expect(
        await UpgradeRunnerRepository.create({ postgres: scratch.postgres }).findLease({
          name: "upgrade",
        }),
      ).toBeNull();
    });
  });

  describe("when the run outlasts the lease's lifetime", () => {
    /** @scenario "The lease is renewed on a heartbeat while the run is in progress" */
    it("renews the lease so no other runner can take it mid-run", async () => {
      let intruder: unknown = "not tried";
      const applier = fakeApplier({
        release: "3.21.0",
        during: async () => {
          await sleep(900);
          intruder = await ledger().acquireLease({
            name: "upgrade",
            owner: "x",
            image: "x",
            host: "x",
            ttlMs: 1_000,
          });
        },
      });
      const outcome = await run(
        runnerFor({
          release: "3.21.0",
          applier,
          lease: { ttlMs: 400, heartbeatMs: 100, waitMs: 1_000, pollMs: 50 },
        }),
      );
      expect(intruder).toBeNull();
      expect(outcome.code).toBe("done");
    });
  });

  describe("when _prisma_migrations holds a failed migration", () => {
    /** @scenario "A failed Prisma migration is named with the resolve command before anything is applied" */
    it("exits 1 naming the migration and the resolve command, before the applier runs", async () => {
      await scratch.postgres.query(
        `INSERT INTO "_prisma_migrations" ("migration_name", "logs") VALUES ('20261001000000_broken', 'boom')`,
      );
      const applier = fakeApplier({ release: "3.21.0" });
      const outcome = await run(runnerFor({ release: "3.21.0", applier }));
      expect(outcome).toMatchObject({
        exitCode: 1,
        code: "failed_prisma_migration",
        detail: {
          migrations: ["20261001000000_broken"],
          command: "prisma migrate resolve --rolled-back 20261001000000_broken",
        },
      });
      expect(applier.calls).toEqual([]);
    });
  });

  describe("when a private ClickHouse target fails", () => {
    /** @scenario "A failing private ClickHouse target fails the run and is recorded per target" */
    it("records each target, fails the step and the run", async () => {
      const applier = fakeApplier({
        release: "3.20.1",
        targets: ["shared", "private:org_1"],
        failOn: ["private:org_1"],
      });
      const outcome = await run(runnerFor({ release: "3.20.1", applier }));
      expect(outcome).toMatchObject({ exitCode: 1, code: "schema_failed" });
      const targets = await ledger().findTargets({ stepId: "clickhouse:00001" });
      expect(
        targets.map(({ target, status, lastError }) => ({ target, status, lastError })),
      ).toEqual([
        { target: "private:org_1", status: "failed", lastError: "Code: 210. Connection refused" },
        { target: "shared", status: "done", lastError: null },
      ]);
      expect(await statusOf("clickhouse:00001")).toBe("failed");
      expect((await ledger().findRuns()).at(-1)?.outcome).toBe("failed");
    });
  });

  describe("when the installation is below the LTS floor", () => {
    /** @scenario "An installation below the LTS floor is refused before any schema change" */
    it("exits 2 naming the LTS to stop at, and never calls the applier", async () => {
      await createLedgerTables({ postgres: scratch.postgres });
      const old = await ledger().startRun({ kind: "upgrade" });
      await UpgradeRunnerRepository.create({ postgres: scratch.postgres }).recordRunPlan({
        runId: old.id,
        release: "3.16.0",
        plan: {},
      });
      await ledger().finishRun({ runId: old.id, outcome: "succeeded", report: {} });
      const applier = fakeApplier({ release: "3.21.0" });
      const outcome = await run(runnerFor({ release: "3.21.0", applier }));
      expect(outcome).toMatchObject({
        exitCode: 2,
        code: "refused_below_floor",
        detail: { stopAt: "3.20.1" },
      });
      expect(applier.calls).toEqual([]);
    });
  });

  describe("when the database is empty", () => {
    /** @scenario "A fresh install applies the schema and marks every non-schema step not-needed" */
    it("applies the schema once, records it done, and marks data and tenant steps not-needed", async () => {
      const applier = fakeApplier({ release: "3.21.0" });
      const outcome = await run(runnerFor({ release: "3.21.0", applier }));
      expect(outcome.code).toBe("done");
      expect(applier.calls).toHaveLength(1);
      for (const id of [
        "prisma:20261001000000_base",
        "prisma:20261002000000_add",
        "clickhouse:00001",
        "clickhouse:00002",
      ]) {
        expect(await statusOf(id)).toBe("done");
      }
      expect(await statusOf("dataset:copy-keys")).toBe("not-needed");
      expect(await statusOf("identity:backfill")).toBe("not-needed");
      expect((await ledger().findRuns()).at(-1)).toMatchObject({
        outcome: "succeeded",
        release: "3.21.0",
        floor: "3.20.1",
      });
    });
  });

  describe("when the database has no Prisma history", () => {
    /** @scenario "A database with no Prisma history gets its Postgres schema before the ledger exists" */
    it("bootstraps the Postgres schema before creating any ledger table", async () => {
      await scratch.postgres.query(`DROP TABLE "_prisma_migrations"`);
      let ledgerAtBootstrap: unknown = "not called";
      const applier = {
        ...fakeApplier({ release: "3.21.0" }),
        bootstrapPostgres: async () => {
          const { rows } = await scratch.postgres.query<{ present: boolean }>(
            `SELECT to_regclass('_langwatch_upgrade_lease') IS NOT NULL AS present`,
          );
          ledgerAtBootstrap = rows[0]?.present;
          await scratch.postgres.query(`CREATE TABLE "_prisma_migrations" (
            "migration_name" TEXT NOT NULL, "logs" TEXT, "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
            "finished_at" TIMESTAMPTZ, "rolled_back_at" TIMESTAMPTZ)`);
          return { engine: "postgres" as const, target: "postgres", ok: true, error: null };
        },
      };
      const outcome = await run(runnerFor({ release: "3.21.0", applier }));
      expect(ledgerAtBootstrap).toBe(false);
      expect(outcome.code).toBe("done");
      expect(await statusOf("dataset:copy-keys")).toBe("not-needed");
    });
  });

  describe("when the upgrade already ran", () => {
    /** @scenario "A second run is a no-op" */
    it("exits 0 without applying anything and changes no step row", async () => {
      const applier = fakeApplier({ release: "3.21.0" });
      await run(runnerFor({ release: "3.21.0", applier }));
      const before = await ledger().findSteps();
      const outcome = await run(runnerFor({ release: "3.21.0", applier }));
      expect(outcome.code).toBe("done");
      expect(applier.calls).toHaveLength(1);
      expect(await ledger().findSteps()).toEqual(before);
    });
  });

  describe("when the next release declares a blocking data step", () => {
    /** @scenario "Blocking code steps run after their release's schema and save their checkpoint" */
    it("runs it after the schema and records its report", async () => {
      await run(runnerFor({ release: "3.20.1", applier: fakeApplier({ release: "3.20.1" }) }));
      const applier = fakeApplier({ release: "3.21.0" });
      const copyKeys: MigrationStep = defineMigrationStep({
        id: "dataset:copy-keys",
        kind: "data",
        mode: "blocking",
        description: "copies the keys",
        run: async () => {
          applier.order.push("step");
          return { copied: 3 };
        },
      });
      const outcome = await run(runnerFor({ release: "3.21.0", applier, codeSteps: [copyKeys] }));
      expect(outcome.code).toBe("done");
      expect(applier.order).toEqual(["schema", "step"]);
      const recorded = (await ledger().findSteps()).find((s) => s.id === "dataset:copy-keys");
      expect(recorded).toMatchObject({ status: "done", report: { copied: 3 }, release: "3.21.0" });
    });
  });

  describe("when the applier fails once without leaving a failed migration", () => {
    /** @scenario "A transient schema failure that left no failed migration is retried with backoff" */
    it("waits, retries and completes", async () => {
      const applier = fakeApplier({ release: "3.21.0", failOnce: true });
      const started = performance.now();
      const outcome = await run(
        runnerFor({ release: "3.21.0", applier, retry: { attempts: 3, backoffMs: 100 } }),
      );
      expect(outcome.code).toBe("done");
      expect(applier.calls).toHaveLength(2);
      expect(performance.now() - started).toBeGreaterThanOrEqual(100);
    });
  });

  describe("when a reconciler fails", () => {
    /** @scenario "Reconcilers run last, and a failing one fails the run" */
    it("runs every reconciler after the schema and fails the run naming the failing one", async () => {
      const applier = fakeApplier({ release: "3.21.0" });
      const reconcilers: UpgradeReconciler[] = [
        { name: "ttl", run: async () => void applier.order.push("ttl") },
        {
          name: "langwatchql",
          run: async () => {
            applier.order.push("langwatchql");
            throw new Error("provisioning refused");
          },
        },
      ];
      const outcome = await run(runnerFor({ release: "3.21.0", applier, reconcilers }));
      expect(outcome).toMatchObject({
        exitCode: 1,
        code: "reconciler_failed",
        detail: { reconcilers: ["langwatchql"] },
      });
      expect(applier.order).toEqual(["schema", "ttl", "langwatchql"]);
      expect((await ledger().findRuns()).at(-1)?.outcome).toBe("failed");
    });
  });

  describe("when an older image runs the upgrade", () => {
    /** @scenario "Running an older image marks completed background steps pending again" */
    it("reopens the newer releases' done background steps", async () => {
      await run(runnerFor({ release: "3.22.0", applier: fakeApplier({ release: "3.22.0" }) }));
      const last = (await ledger().findRuns()).at(-1);
      await UpgradeRunnerRepository.create({ postgres: scratch.postgres }).setStatus({
        ids: ["trace:reindex"],
        status: "done",
        runId: last?.id ?? "",
      });
      const outcome = await run(
        runnerFor({ release: "3.21.0", applier: fakeApplier({ release: "3.21.0" }) }),
      );
      expect(outcome).toMatchObject({ code: "done", detail: { reopened: ["trace:reindex"] } });
      expect(await statusOf("trace:reindex")).toBe("pending");
    });
  });
});

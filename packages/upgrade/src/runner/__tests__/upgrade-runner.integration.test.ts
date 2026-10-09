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
import type { UpgradeReadHint } from "../run-hint.ts";
import type { UpgradeRunPhase } from "../run-phases.ts";
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
    options: `-c search_path=${name},${name}_upgrade_ledger`,
  });
  await postgres.query(`CREATE TABLE "_prisma_migrations" (
    "migration_name" TEXT NOT NULL, "logs" TEXT, "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "finished_at" TIMESTAMPTZ, "rolled_back_at" TIMESTAMPTZ)`);
  scratch = { name, postgres, admin };
});

afterEach(async () => {
  await scratch.postgres.end();
  await scratch.admin.query(
    `DROP SCHEMA IF EXISTS "${scratch.name}_upgrade_ledger", "${scratch.name}" CASCADE`,
  );
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
    /** @scenario "The ledger gets its own Postgres schema first, so Prisma's first deploy runs under the lease" */
    it("creates the ledger schema and lease before the schema applier runs, inside the lease", async () => {
      await scratch.postgres.query(`DROP TABLE "_prisma_migrations"`);
      const seen: { lease?: string | null; installationTables?: string[] } = {};
      const lines: string[] = [];
      const base = fakeApplier({ release: "3.21.0" });
      const applier: UpgradeSchemaApplier = {
        async apply(args) {
          const lease = await scratch.postgres.query<{ owner: string }>(
            `SELECT "owner" FROM "${scratch.name}_upgrade_ledger"."_langwatch_upgrade_lease"`,
          );
          const tables = await scratch.postgres.query<{ name: string }>(
            `SELECT table_name AS name FROM information_schema.tables WHERE table_schema = $1`,
            [scratch.name],
          );
          seen.lease = lease.rows[0]?.owner ?? null;
          seen.installationTables = tables.rows.map((row) => row.name);
          await scratch.postgres.query(`CREATE TABLE "_prisma_migrations" (
            "migration_name" TEXT NOT NULL, "logs" TEXT, "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
            "finished_at" TIMESTAMPTZ, "rolled_back_at" TIMESTAMPTZ)`);
          return base.apply(args);
        },
      };
      const log = { info: (message: string) => void lines.push(message), warn: () => {} };
      const outcome = await run(runnerFor({ release: "3.21.0", applier, log }));
      expect(seen.lease).toMatch(/^pod-b:/);
      expect(seen.installationTables).toEqual([]);
      expect(outcome.code).toBe("done");
      expect(await statusOf("dataset:copy-keys")).toBe("not-needed");
      expect(lines).toContainEqual(
        expect.stringMatching(
          new RegExp(`^upgrade ledger ready in Postgres schema ${scratch.name}_upgrade_ledger`),
        ),
      );
    });
  });

  describe("when the ledger schema cannot be created", () => {
    /** @scenario "A ledger that cannot be created fails the run naming the privilege it needs" */
    it("fails with schema_failed, names CREATE on the database and applies nothing", async () => {
      const applier = fakeApplier({ release: "3.21.0" });
      const refusing = {
        query: async <Row extends object>(text: string, values?: unknown[]) => {
          if (text.startsWith("DO $ledger$"))
            throw new Error("permission denied for database langwatch");
          return scratch.postgres.query<Row>(text, values);
        },
      };
      const outcome = await run(runnerFor({ release: "3.21.0", applier, postgres: refusing }));
      expect(outcome.code).toBe("schema_failed");
      expect(outcome.message).toContain("needs CREATE on the database");
      expect(outcome.message).toContain("permission denied");
      expect(applier.calls).toEqual([]);
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

  describe("when the upgrade jumps two releases that each carry schema and a blocking step", () => {
    /** @scenario "A jump across two releases applies each release's schema, then its blocking steps, release by release" */
    it("applies the older release's schema and step before the newer release's", async () => {
      await run(runnerFor({ release: "3.20.1", applier: fakeApplier({ release: "3.20.1" }) }));
      const manifests: ReleaseManifest[] = [
        ...MANIFESTS.slice(0, 2),
        {
          release: "3.22.0",
          previous: "3.21.0",
          cutAt: "2026-10-04T09:00:00+02:00",
          steps: [
            step("prisma:20261003000000_more", "postgres-schema"),
            step("trace:rekey", "data"),
          ],
        },
      ];
      const upTo = (release: string) =>
        manifests.filter((m) => m.release <= release).flatMap((m) => m.steps.map((s) => s.id));
      const order: string[] = [];
      const applier: UpgradeSchemaApplier = {
        async apply({ release }) {
          order.push(`schema ${release}`);
          const ids = upTo(release ?? "3.22.0");
          for (const id of ids.filter((each) => each.startsWith("prisma:"))) {
            await scratch.postgres.query(
              `INSERT INTO "_prisma_migrations" ("migration_name", "finished_at")
               SELECT $1::text, now() WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE "migration_name" = $1::text)`,
              [id.slice("prisma:".length)],
            );
          }
          const goose = new Set(ids.filter((each) => each.startsWith("clickhouse:")));
          return [
            { engine: "postgres", target: "postgres", ok: true, error: null },
            { engine: "clickhouse", target: "shared", ok: true, error: null, applied: goose },
          ];
        },
      };
      const blocking = (id: string): MigrationStep =>
        defineMigrationStep({
          id,
          kind: "data",
          mode: "blocking",
          description: `runs ${id}`,
          run: async () => {
            order.push(`step ${id}`);
            return {};
          },
        });
      const outcome = await run(
        runnerFor({
          release: "3.22.0",
          applier,
          image: { release: "3.22.0", steps: manifests.flatMap((m) => m.steps) },
          releases: { manifests, floor: FLOOR },
          codeSteps: [blocking("dataset:copy-keys"), blocking("trace:rekey")],
        }),
      );
      expect(outcome.code).toBe("done");
      expect(order).toEqual([
        "schema 3.21.0",
        "step dataset:copy-keys",
        "schema 3.22.0",
        "step trace:rekey",
      ]);
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

  describe("when the upgrade loses its lease while a blocking step runs", () => {
    /** @scenario "A blocking step that returns after the upgrade lost its lease stays resumable" */
    it("records the step neither done nor failed, keeps its checkpoint and resumes it next run", async () => {
      await run(runnerFor({ release: "3.20.1", applier: fakeApplier({ release: "3.20.1" }) }));
      const resumedFrom: unknown[] = [];
      const copyKeys = (stealLease: boolean): MigrationStep =>
        defineMigrationStep({
          id: "dataset:copy-keys",
          kind: "data",
          mode: "blocking",
          description: "copies the keys",
          run: async ({ checkpoint, signal }) => {
            resumedFrom.push(checkpoint.resumeFrom);
            if (!stealLease) return { copied: 3 };
            await checkpoint.save({ report: { cursor: "key_7" } });
            await scratch.postgres.query(`UPDATE "_langwatch_upgrade_lease" SET "owner" = 'pod-x'`);
            while (!signal.aborted) await new Promise((resolve) => setTimeout(resolve, 10));
            return { copied: 1 };
          },
        });
      const lease = { ttlMs: 60_000, heartbeatMs: 20, waitMs: 2_000, pollMs: 50 };
      const lost = await run(
        runnerFor({
          release: "3.21.0",
          applier: fakeApplier({ release: "3.21.0" }),
          codeSteps: [copyKeys(true)],
          lease,
        }),
      );
      expect(lost.code).toBe("lease_lost");
      const left = (await ledger().findSteps()).find((s) => s.id === "dataset:copy-keys");
      expect(left).toMatchObject({ status: "running", report: { cursor: "key_7" } });

      await scratch.postgres.query(`DELETE FROM "_langwatch_upgrade_lease"`);
      const resumed = await run(
        runnerFor({
          release: "3.21.0",
          applier: fakeApplier({ release: "3.21.0" }),
          codeSteps: [copyKeys(false)],
        }),
      );
      expect(resumed.code).toBe("done");
      expect(resumedFrom).toEqual([null, { cursor: "key_7" }]);
      expect(await statusOf("dataset:copy-keys")).toBe("done");
    });
  });

  describe("when a background step failed before this run", () => {
    /** @scenario "An upgrade run resets failed background steps to pending" */
    it("sets it pending in the preflight with its error and checkpoint kept", async () => {
      await run(runnerFor({ release: "3.21.0", applier: fakeApplier({ release: "3.21.0" }) }));
      const repository = UpgradeRunnerRepository.create({ postgres: scratch.postgres });
      await repository.saveReport({ id: "identity:backfill", report: { cursor: "org_9" } });
      await repository.setStatus({
        ids: ["identity:backfill"],
        status: "failed",
        runId: "background:worker-1",
        lastError: "lock timeout",
      });

      const outcome = await run(
        runnerFor({ release: "3.21.0", applier: fakeApplier({ release: "3.21.0" }) }),
      );

      expect(outcome.code).toBe("done");
      const row = (await ledger().findSteps()).find((s) => s.id === "identity:backfill");
      expect(row).toMatchObject({
        status: "pending",
        lastError: "lock timeout",
        report: { cursor: "org_9" },
      });
    });
  });

  describe("when a rollback reopens a done projection replay step and a done backfill", () => {
    /** @scenario "A rollback reopen keeps a projection replay step's cursor" */
    it("keeps the replay's cursor and clears the backfill's checkpoint", async () => {
      await run(runnerFor({ release: "3.22.0", applier: fakeApplier({ release: "3.22.0" }) }));
      const repository = UpgradeRunnerRepository.create({ postgres: scratch.postgres });
      const replayed = { lane: "trace:summary", replayedThrough: "2026-10-08T10:00:00.000Z" };
      await repository.setStatus({
        ids: ["trace:reindex"],
        status: "done",
        runId: "background:worker-1",
        report: replayed,
      });
      await repository.setStatus({
        ids: ["identity:backfill"],
        status: "done",
        runId: "background:worker-1",
        report: { cursor: "org_9" },
      });

      await repository.reopenDoneSteps({
        ids: ["trace:reindex", "identity:backfill"],
        reason: "reopened: rollback",
      });

      const rows = new Map((await ledger().findSteps()).map((row) => [row.id, row]));
      expect(rows.get("trace:reindex")).toMatchObject({ status: "pending", report: replayed });
      expect(rows.get("identity:backfill")).toMatchObject({ status: "pending", report: null });
    });
  });

  describe("when a run moves through its phases", () => {
    const phasesOf = async () =>
      ((await ledger().findRuns()).at(-1)?.report?.phases ?? []) as UpgradeRunPhase[];

    /** @scenario "A finished run's report carries its phases" */
    it("writes preflight, both schema phases and reconcile, each succeeded", async () => {
      await run(runnerFor({ release: "3.21.0", applier: fakeApplier({ release: "3.21.0" }) }));
      const phases = await phasesOf();
      expect(phases.map((phase) => phase.name)).toEqual([
        "preflight",
        "postgres-schema",
        "clickhouse-schema",
        "reconcile",
      ]);
      for (const phase of phases) {
        expect(phase).toMatchObject({ outcome: "succeeded" });
        expect(Date.parse(phase.finishedAt ?? "")).toBeGreaterThanOrEqual(
          Date.parse(phase.startedAt),
        );
      }
    });

    /** @scenario "A run whose schema fails records the failed phase and no later one" */
    it("ends with a failed ClickHouse schema phase and records no reconcile", async () => {
      const applier = fakeApplier({ release: "3.20.1", failOn: ["shared"] });
      await run(runnerFor({ release: "3.20.1", applier }));
      const phases = await phasesOf();
      expect(phases.at(-1)).toMatchObject({ name: "clickhouse-schema", outcome: "failed" });
      expect(phases.find((phase) => phase.name === "postgres-schema")?.outcome).toBe("succeeded");
      expect(phases.some((phase) => phase.name === "reconcile")).toBe(false);
    });

    /** @scenario "A refused upgrade is recorded as a failed run whose report names the refusal" */
    it("records the refusal as a failed run with one failed preflight", async () => {
      await createLedgerTables({ postgres: scratch.postgres });
      const old = await ledger().startRun({ kind: "upgrade" });
      const runner = UpgradeRunnerRepository.create({ postgres: scratch.postgres });
      await runner.recordRunPlan({ runId: old.id, release: "3.16.0", plan: {} });
      await ledger().finishRun({ runId: old.id, outcome: "succeeded", report: {} });
      await run(runnerFor({ release: "3.21.0", applier: fakeApplier({ release: "3.21.0" }) }));
      const refused = (await ledger().findRuns()).at(-1);
      expect(refused).toMatchObject({
        outcome: "failed",
        report: { refused: "below_lts_floor" },
      });
      expect((await phasesOf()).map(({ name, outcome }) => ({ name, outcome }))).toEqual([
        { name: "preflight", outcome: "failed" },
      ]);
    });

    /** @scenario "A read hint is published at each phase change and at the finish" */
    it("publishes a hint as each phase starts and ends, then once at the finish", async () => {
      const hints: UpgradeReadHint[] = [];
      const outcome = await run(
        runnerFor({
          release: "3.21.0",
          applier: fakeApplier({ release: "3.21.0" }),
          hints: async (hint) => void hints.push(hint),
        }),
      );
      const moves = hints.map(({ phase, outcome: moved }) => `${phase ?? "run"}:${moved}`);
      expect(moves).toEqual([
        "preflight:running",
        "preflight:succeeded",
        "postgres-schema:running",
        "clickhouse-schema:running",
        "postgres-schema:succeeded",
        "clickhouse-schema:succeeded",
        "reconcile:running",
        "reconcile:succeeded",
        "run:succeeded",
      ]);
      for (const hint of hints)
        expect(hint).toMatchObject({ path: "upgrade.run", runId: outcome.runId });
    });

    /** @scenario "A hint that cannot be published does not fail the run" */
    it("succeeds and warns once per refused publish", async () => {
      const warnings: string[] = [];
      const outcome = await run(
        runnerFor({
          release: "3.21.0",
          applier: fakeApplier({ release: "3.21.0" }),
          hints: async () => {
            throw new Error("redis is down");
          },
          log: { info: () => {}, warn: (message) => void warnings.push(message) },
        }),
      );
      expect(outcome).toMatchObject({ code: "done", exitCode: 0 });
      expect(warnings.filter((message) => message.includes("read hint"))).toHaveLength(9);
    });
  });

  describe("when a later release drops what an earlier release's background step reads", () => {
    const manifests: ReleaseManifest[] = [
      ...MANIFESTS.slice(0, 2),
      {
        release: "3.22.0",
        previous: "3.21.0",
        cutAt: "2026-10-04T09:00:00+02:00",
        steps: [step("prisma:20261003000000_drop_old", "postgres-schema")],
      },
    ];
    const upTo = (release: string | null) =>
      manifests
        .filter((m) => release === null || m.release <= release)
        .flatMap((m) => m.steps.map((s) => s.id));
    const recording = (order: string[]): UpgradeSchemaApplier => ({
      async apply({ release }) {
        order.push(`schema ${release}`);
        for (const id of upTo(release).filter((each) => each.startsWith("prisma:"))) {
          await scratch.postgres.query(
            `INSERT INTO "_prisma_migrations" ("migration_name", "finished_at")
             SELECT $1::text, now() WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE "migration_name" = $1::text)`,
            [id.slice("prisma:".length)],
          );
        }
        const goose = new Set(upTo(release).filter((each) => each.startsWith("clickhouse:")));
        return [
          { engine: "postgres", target: "postgres", ok: true, error: null },
          { engine: "clickhouse", target: "shared", ok: true, error: null, applied: goose },
        ];
      },
    });
    const upgradeTo = ({ release, order }: { release: string; order: string[] }) =>
      run(
        runnerFor({
          release,
          applier: recording(order),
          image: {
            release,
            steps: manifests.filter((m) => m.release <= release).flatMap((m) => m.steps),
          },
          releases: { manifests, floor: FLOOR },
          contracts: new Map([["prisma:20261003000000_drop_old", []]]),
          codeSteps: [
            defineMigrationStep({
              id: "dataset:copy-keys",
              kind: "data",
              mode: "blocking",
              description: "copies the keys",
              run: async () => ({}),
            }),
            defineMigrationStep({
              id: "identity:backfill",
              kind: "data",
              mode: "background",
              description: "backfills identifiers",
              needsOldWritersGone: true,
              run: async () => {
                order.push("step identity:backfill");
                return {};
              },
            }),
          ],
        }),
      );

    /** @scenario "A jump runs the earlier release's unfinished background step before the contract release's schema" */
    it("runs the background step between the two releases' schema", async () => {
      await run(runnerFor({ release: "3.20.1", applier: fakeApplier({ release: "3.20.1" }) }));
      const order: string[] = [];
      const outcome = await upgradeTo({ release: "3.22.0", order });
      expect(outcome.code).toBe("done");
      expect(order).toEqual(["schema 3.21.0", "step identity:backfill", "schema 3.22.0"]);
      expect(await statusOf("identity:backfill")).toBe("done");
    });

    /** @scenario "A background step the worker finished is not run again before the contract release's schema" */
    it("does not run the step the worker already finished", async () => {
      await run(runnerFor({ release: "3.20.1", applier: fakeApplier({ release: "3.20.1" }) }));
      await upgradeTo({ release: "3.21.0", order: [] });
      await UpgradeRunnerRepository.create({ postgres: scratch.postgres }).setStatus({
        ids: ["identity:backfill"],
        status: "done",
        runId: "background:worker-1",
      });
      const order: string[] = [];
      const outcome = await upgradeTo({ release: "3.22.0", order });
      expect(outcome.code).toBe("done");
      expect(order).toEqual(["schema 3.22.0"]);
    });
  });

  describe("when the image declares event upcasts", () => {
    const upcast = (storedEvents: number) => [
      { id: "upcast:entitlement:lw.usage.month_counted", storedEvents, report: {} },
    ];

    /** @scenario "An upgrade run records each declared event upcast in the ledger" */
    it("records each upcast as a background event-upcast step after the schema", async () => {
      const applier = fakeApplier({ release: "3.21.0" });
      const outcome = await run(
        runnerFor({ release: "3.21.0", applier, upcasts: async () => upcast(2) }),
      );
      expect(outcome.code).toBe("done");
      const step = (await ledger().findSteps()).find((s) => s.id === upcast(0)[0]?.id);
      expect(step).toMatchObject({ kind: "event-upcast", mode: "background", status: "pending" });
      await run(runnerFor({ release: "3.21.0", applier, upcasts: async () => upcast(0) }));
      expect(await statusOf("upcast:entitlement:lw.usage.month_counted")).toBe("done");
    });

    /** @scenario "An upgrade run that cannot count an upcast's stored events fails" */
    it("fails the run when the upcasts cannot be read", async () => {
      const applier = fakeApplier({ release: "3.21.0" });
      const upcasts = async () => {
        throw new Error("Code: 210. Connection refused");
      };
      const outcome = await run(runnerFor({ release: "3.21.0", applier, upcasts }));
      expect(outcome.code).toBe("failed");
      expect(outcome.message).toContain("Connection refused");
    });
  });
});

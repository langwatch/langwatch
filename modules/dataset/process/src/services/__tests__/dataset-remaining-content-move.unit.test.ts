/**
 * @vitest-environment node
 *
 * The remaining-content move, as the worker runs it: the dataset module booted over memory
 * stores, its declared steps swept by the background-steps service. The first move shipped in
 * 3.21.0 and is recorded done on every install that ran it, so the datasets created since are
 * moved by a step under a new id.
 */
import { AuthzApi } from "@langwatch/authz-contract";
import { DatasetApi, datasetRecordSchema } from "@langwatch/dataset-contract";
import { EntitlementApi } from "@langwatch/entitlement-contract";
import { bootInstalledProcess } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import { testPeer } from "@langwatch/process/testing";
import { ProjectApi } from "@langwatch/project-contract";
import { StoredObjectApi } from "@langwatch/stored-object-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { BackgroundStepsService, type BackgroundStepsLedger } from "@langwatch/upgrade/background";
import { isMigrationStep, type MigrationStep } from "@langwatch/upgrade/step";
import { UserApi } from "@langwatch/user-contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createDatasetTestAuthz,
  createDatasetTestEntitlement,
  createDatasetTestProjects,
} from "../../app/__tests__/dataset.fixture.ts";
import { datasetProcessModule } from "../../dataset.module.ts";
import { MemoryDatasetContentRepository } from "../../repositories/memory/memory.dataset-content.repository.ts";
import { MemoryDatasetDatabase } from "../../repositories/memory/memory.dataset.database.ts";
import { ObjectStorageDatasetChunkRepository } from "../../repositories/object-storage/object-storage.dataset-chunk.repository.ts";

const FIRST_MOVE = "dataset:move-content-to-object-storage";
const REMAINING_MOVE = "dataset:move-remaining-content-to-object-storage";
const projectId = "project_remaining";
const otherProjectId = "project_elsewhere";

let stop: (() => Promise<void>) | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  await stop?.();
  stop = undefined;
});

/** The worker, with the memory database and repositories its dataset module was given. */
async function worker() {
  let database: MemoryDatasetDatabase | undefined;
  let chunks: ObjectStorageDatasetChunkRepository | undefined;
  const createDatabase = MemoryDatasetDatabase.create.bind(MemoryDatasetDatabase);
  vi.spyOn(MemoryDatasetDatabase, "create").mockImplementation(() => {
    database = createDatabase();
    return database;
  });
  const createChunks = ObjectStorageDatasetChunkRepository.create.bind(
    ObjectStorageDatasetChunkRepository,
  );
  vi.spyOn(ObjectStorageDatasetChunkRepository, "create").mockImplementation((input) => {
    chunks = createChunks(input);
    return chunks;
  });
  const projects = Object.assign(createDatasetTestProjects(), {
    listAllIds: vi.fn(async () => ({ ids: [projectId], next: null })),
  });
  const runtime = await bootInstalledProcess({
    role: "worker",
    modules: [datasetProcessModule],
    config: { dataset: { publicBaseUrl: undefined } },
    stores: memoryStores(),
    peers: [
      testPeer({ token: AuthzApi, instance: createDatasetTestAuthz() }),
      testPeer({ token: ProjectApi, instance: projects }),
      testPeer({ token: EntitlementApi, instance: createDatasetTestEntitlement() }),
      testPeer({ token: StoredObjectApi, instance: createApiFixture<StoredObjectApi>() }),
      testPeer({ token: UserApi, instance: createApiFixture<UserApi>() }),
    ],
  });
  stop = () => runtime.stop();
  const steps = runtime.migrationSteps(isMigrationStep);
  if (!database || !chunks) throw new Error("the dataset module booted no memory database");
  const db = database;
  const content = MemoryDatasetContentRepository.create({ database: db });
  const chunkStore = chunks;

  /** A dataset an older image left in the records table, holding these rows in this order. */
  const recordsTableDataset = async (
    rows: { id: string; entry: Record<string, unknown>; projectId?: string }[],
    input: { archived?: boolean } = {},
  ) => {
    const dataset = await content.create({
      projectId,
      name: `remaining-${Math.random()}`,
      slug: `remaining-${Math.random().toString(36).slice(2)}`,
      columnTypes: [{ name: "question", type: "string" }],
      contentLayout: "postgres",
    });
    if (input.archived) db.putDataset({ ...dataset, archivedAt: new Date("2026-10-01T00:00:00Z") });
    rows.forEach((row, index) => {
      const at = new Date(Date.UTC(2026, 9, 1, 0, 0, index));
      db.putRecord(
        datasetRecordSchema.parse({
          id: row.id,
          datasetId: dataset.id,
          projectId: row.projectId ?? projectId,
          entry: row.entry,
          createdAt: at,
          updatedAt: at,
        }),
      );
    });
    return dataset.id;
  };
  const row = (datasetId: string) => db.getDataset(projectId, datasetId);
  const chunkRows = async (datasetId: string) =>
    chunkStore.readChunks({
      projectId,
      datasetId,
      chunkCount: row(datasetId).chunkCount ?? 0,
    });
  const read = async (datasetId: string) =>
    (
      await runtime
        .service(DatasetApi)
        .getDatasetWithRecords({ projectId, slugOrId: datasetId, limitMb: null })
    ).records.map((record) => ({ id: record.id, entry: record.entry }));
  const step = (id: string): MigrationStep => {
    const found = steps.find((declared) => declared.id === id);
    if (!found) throw new Error(`the dataset module declares no step ${id}`);
    return found;
  };
  const runStep = (id: string) =>
    step(id).run({
      checkpoint: { resumeFrom: null, save: async () => undefined },
      dryRun: false,
      signal: new AbortController().signal,
      log: { info: () => undefined, warn: () => undefined },
    });
  return { steps, recordsTableDataset, row, chunkRows, read, runStep };
}

/** The step table in memory: every dataset step done except the ones named pending. */
function ledgerWith(steps: readonly MigrationStep[], pending: readonly string[]) {
  const rows = new Map(
    steps.map((step) => [
      step.id,
      { id: step.id, status: pending.includes(step.id) ? "pending" : "done", report: null },
    ]),
  );
  const ledger: BackgroundStepsLedger = {
    findSteps: async () => [...rows.values()] as never,
    acquireLease: async () => ({}),
    renewLease: async () => ({}),
    releaseLease: async () => true,
    markRunning: async ({ id }) => {
      rows.set(id, { id, status: "running", report: null });
    },
    setStatus: async ({ ids, status }) => {
      for (const id of ids) rows.set(id, { id, status, report: null });
    },
    saveReport: async () => undefined,
    reopen: async () => [],
  };
  return { ledger, status: (id: string) => rows.get(id)?.status };
}

function sweeper(input: {
  steps: readonly MigrationStep[];
  ledger: BackgroundStepsLedger;
  oldWritersGone: boolean;
}) {
  return BackgroundStepsService.create({
    ledger: input.ledger,
    steps: input.steps,
    serving: () => true,
    oldWritersGoneFor: async () => input.oldWritersGone,
    identity: { owner: "worker-1", image: "3.24.0", host: "host" },
    log: () => undefined,
  });
}

const fourRows = ["r1", "r2", "r3", "r4"].map((id) => ({ id, entry: { question: `q-${id}` } }));

describe("the remaining-content move", () => {
  describe("given the first content move is recorded done", () => {
    /** @scenario "The remaining-content move runs where the first move is already recorded done" */
    it("runs and moves a dataset created afterwards, keeping its ids and order", async () => {
      const { steps, recordsTableDataset, row, read } = await worker();
      const datasetId = await recordsTableDataset(fourRows);
      const { ledger, status } = ledgerWith(steps, [REMAINING_MOVE]);
      expect(status(FIRST_MOVE)).toBe("done");

      const sweep = await sweeper({ steps, ledger, oldWritersGone: true }).sweep({
        signal: new AbortController().signal,
      });

      expect(sweep.ran).toContain(REMAINING_MOVE);
      expect(status(REMAINING_MOVE)).toBe("done");
      expect(row(datasetId).contentLayout).toBe("s3_jsonl");
      expect(await read(datasetId)).toEqual(fourRows);
    });
  });

  describe("given an image that still creates records-table datasets is serving", () => {
    /** @scenario "The remaining-content move waits until no older image is serving" */
    it("stays pending and moves nothing", async () => {
      const { steps, recordsTableDataset, row } = await worker();
      const datasetId = await recordsTableDataset(fourRows);
      const { ledger, status } = ledgerWith(steps, [REMAINING_MOVE]);

      const sweep = await sweeper({ steps, ledger, oldWritersGone: false }).sweep({
        signal: new AbortController().signal,
      });

      expect(sweep.waiting).toContain(REMAINING_MOVE);
      expect(status(REMAINING_MOVE)).toBe("pending");
      expect(row(datasetId).contentLayout).toBe("postgres");
    });

    it("is declared as a background data step after the first move", async () => {
      const { steps } = await worker();
      const declared = steps.find((step) => step.id === REMAINING_MOVE);

      expect(declared).toMatchObject({
        kind: "data",
        mode: "background",
        needsOldWritersGone: true,
      });
      expect(declared?.after).toContain(FIRST_MOVE);
      expect(steps.find((step) => step.id === "dataset:create-first-versions")?.after).toContain(
        REMAINING_MOVE,
      );
    });
  });

  describe("given an archived dataset whose 2 rows are in the records table", () => {
    /** @scenario "An archived dataset is moved too" */
    it("moves its rows to object storage and keeps it archived", async () => {
      const { recordsTableDataset, row, chunkRows, runStep } = await worker();
      const rows = fourRows.slice(0, 2);
      const datasetId = await recordsTableDataset(rows, { archived: true });

      const report = await runStep(REMAINING_MOVE);

      expect(row(datasetId)).toMatchObject({ contentLayout: "s3_jsonl", rowCount: 2 });
      expect(row(datasetId).archivedAt).not.toBeNull();
      expect(await chunkRows(datasetId)).toEqual(rows);
      expect(report).toMatchObject({ migrated: 1, archived: 1 });
    });
  });

  describe("given a dataset in the records table with no rows", () => {
    /** @scenario "An empty dataset is moved as an empty dataset" */
    it("is stored in object storage with 0 rows and no chunks", async () => {
      const { recordsTableDataset, row, runStep } = await worker();
      const datasetId = await recordsTableDataset([]);

      const report = await runStep(REMAINING_MOVE);

      expect(row(datasetId)).toMatchObject({
        contentLayout: "s3_jsonl",
        rowCount: 0,
        chunkCount: 0,
      });
      expect(report).toMatchObject({ migrated: 1, empty: 1 });
    });
  });

  describe("given a dataset with 3 rows, one of them filed under another project", () => {
    /** @scenario "Rows filed under a different project than their dataset are reported, not moved" */
    it("moves the 2 rows of its own project and reports the other one", async () => {
      const { recordsTableDataset, read, runStep } = await worker();
      const datasetId = await recordsTableDataset([
        fourRows[0]!,
        { ...fourRows[1]!, projectId: otherProjectId },
        fourRows[2]!,
      ]);

      const report = await runStep(REMAINING_MOVE);

      expect(await read(datasetId)).toEqual([fourRows[0], fourRows[2]]);
      expect(report).toMatchObject({
        rowsUnderOtherProject: [{ datasetId, projectId, rows: 1 }],
      });
    });
  });
});

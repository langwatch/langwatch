/**
 * @vitest-environment node
 * A record write that read the dataset in the records table, then waited on its lock while the
 * content move flipped it, lands in the chunks (write-paths.feature).
 */
import { describe, expect, it } from "vitest";

import { createDatasetTestApp } from "../../app/__tests__/dataset.fixture.ts";
import type { DatasetRepositories } from "../../repositories/dataset.repositories.ts";
import { MemoryDatasetRepositories } from "../../repositories/memory/memory.dataset.repositories.ts";
import { DatasetMigrationService } from "../dataset-migration.service.ts";

const PROJECT = "project-1";

/** A records-table dataset whose move runs while the next record write waits on the lock. */
async function movedWhileWaiting() {
  const repositories: DatasetRepositories = MemoryDatasetRepositories.create();
  const app = createDatasetTestApp({ repositories });
  const created = await app.upsertDataset({
    projectId: PROJECT,
    name: "moved-while-waiting",
    columnTypes: [{ name: "input", type: "string" }],
  });
  const datasetId = created.id;
  await repositories.content.update({
    id: datasetId,
    projectId: PROJECT,
    data: {
      contentLayout: "postgres",
      rowCount: null,
      chunkCount: null,
      sizeBytes: null,
      chunkOffsets: null,
    },
  });
  await repositories.records.createMany({
    datasetId,
    projectId: PROJECT,
    entries: ["a", "b", "c"].map((id) => ({ id, input: `row ${id}` })),
  });
  const lock = repositories.records.withDatasetLock.bind(repositories.records);
  let moved = false;
  repositories.records.withDatasetLock = async (key, write) => {
    if (!moved) {
      moved = true;
      await DatasetMigrationService.create({
        repository: repositories.migration,
        storage: repositories.migrationChunks,
        projects: { listAllIds: async () => ({ ids: [PROJECT], next: null }) },
      }).run();
    }
    return lock(key, write);
  };
  const ids = async () =>
    (
      await app.getDatasetWithRecords({ projectId: PROJECT, slugOrId: datasetId, limitMb: null })
    ).records.map((record) => record.id);
  return { app, repositories, datasetId, ids };
}

describe("a record write that waited while the content move flipped the dataset", () => {
  /** @scenario "A record write that waited while the dataset moved goes to object storage" */
  it("deletes the row from the chunks", async () => {
    const { app, datasetId, ids } = await movedWhileWaiting();

    const deleted = await app.deleteRecords({
      projectId: PROJECT,
      slugOrId: datasetId,
      recordIds: ["b"],
    });

    expect(deleted).toEqual({ count: 1 });
    await expect(ids()).resolves.toEqual(["a", "c"]);
  });

  /** @scenario "A record write that waited while the dataset moved goes to object storage" */
  it("adds the rows to the chunks", async () => {
    const { app, datasetId, ids } = await movedWhileWaiting();

    await app.batchCreateRecords({
      projectId: PROJECT,
      slugOrId: datasetId,
      entries: [{ id: "d", input: "row d" }],
    });

    await expect(ids()).resolves.toEqual(["a", "b", "c", "d"]);
  });

  /** @scenario "A record write that waited while the dataset moved goes to object storage" */
  it("refuses a row whose id the move already copied, as the records table would", async () => {
    const { app, datasetId, ids } = await movedWhileWaiting();

    const refusal = await app
      .batchCreateRecords({
        projectId: PROJECT,
        slugOrId: datasetId,
        entries: [
          { id: "d", input: "row d" },
          { id: "b", input: "a second b" },
        ],
      })
      .catch((error: unknown) => error);

    expect(refusal).toMatchObject({ code: "dataset_duplicate_record_id", httpStatus: 409 });
    await expect(ids()).resolves.toEqual(["a", "b", "c"]);
  });

  /** @scenario "A record write that waited while the dataset moved goes to object storage" */
  it("edits the row in the chunks", async () => {
    const { app, datasetId } = await movedWhileWaiting();

    await app.upsertRecord({
      projectId: PROJECT,
      slugOrId: datasetId,
      recordId: "a",
      updatedRecord: { input: "edited" },
    });

    const { records } = await app.getDatasetWithRecords({
      projectId: PROJECT,
      slugOrId: datasetId,
      limitMb: null,
    });
    expect(records.map((record) => [record.id, record.entry.input])).toEqual([
      ["a", "edited"],
      ["b", "row b"],
      ["c", "row c"],
    ]);
  });
});

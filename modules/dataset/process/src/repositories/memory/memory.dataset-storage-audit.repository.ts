import type {
  DatasetStorageAuditRepository,
  DatasetStorageLeftovers,
} from "../dataset-storage-audit.repository.ts";
import type { MemoryDatasetDatabase } from "./memory.dataset.database.ts";

/** The audit's counts over the memory twin's rows, by the same rules as the Postgres one. */
export class MemoryDatasetStorageAuditRepository implements DatasetStorageAuditRepository {
  #database: MemoryDatasetDatabase;

  private constructor(database: MemoryDatasetDatabase) {
    this.#database = database;
  }

  static create(input: Readonly<{ database: MemoryDatasetDatabase }>) {
    return new MemoryDatasetStorageAuditRepository(input.database);
  }

  async countLeftovers({ projectId }: { projectId: string }): Promise<DatasetStorageLeftovers> {
    const datasets = new Map(this.#database.datasets().map((row) => [row.id, row]));
    const leftovers: DatasetStorageLeftovers = {
      recordsTableDatasets: 0,
      recordsTableRows: 0,
      singleFileDatasets: 0,
      rowsAwaitingCleanup: 0,
      rowsUnderOtherProject: 0,
      orphanRows: 0,
    };
    for (const row of datasets.values()) {
      if (row.projectId !== projectId || row.contentLayout !== "postgres") continue;
      if (row.useS3) leftovers.singleFileDatasets += 1;
      else leftovers.recordsTableDatasets += 1;
    }
    for (const record of this.#database.records()) {
      if (record.projectId !== projectId) continue;
      const dataset = datasets.get(record.datasetId);
      if (!dataset) leftovers.orphanRows += 1;
      else if (dataset.projectId !== projectId) leftovers.rowsUnderOtherProject += 1;
      else if (dataset.contentLayout === "s3_jsonl") leftovers.rowsAwaitingCleanup += 1;
      else if (!dataset.useS3) leftovers.recordsTableRows += 1;
    }
    return leftovers;
  }
}

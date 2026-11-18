import { type Dataset, DatasetRecordsTableWriteRefusedError } from "@langwatch/dataset-contract";

import type {
  DatasetRecordRepository,
  LockedDatasetRecords,
} from "../repositories/dataset-record.repository.ts";
import { assertColumnsCurrent } from "../rules/dataset-columns.rules.ts";

/**
 * A records-table write under the dataset's lock, the one a column edit and the content move
 * hold, after refusing a write keyed by a column that edit removed. A write the move beat to the
 * lock is refused by the table and goes where the rows went (write-paths.feature).
 */
export class DatasetLockedRecordsService<Content> {
  static create<Content>(deps: {
    records: DatasetRecordRepository;
    current: (dataset: Dataset) => Promise<Dataset>;
    contentOf: (dataset: Dataset) => Content | undefined;
  }): DatasetLockedRecordsService<Content> {
    return new DatasetLockedRecordsService(deps);
  }

  private constructor(
    private readonly deps: {
      records: DatasetRecordRepository;
      current: (dataset: Dataset) => Promise<Dataset>;
      contentOf: (dataset: Dataset) => Content | undefined;
    },
  ) {}

  async write<T>(
    { dataset, columns }: { dataset: Dataset; columns?: readonly string[] | undefined },
    write: (records: LockedDatasetRecords) => Promise<T>,
    moved: (content: Content, dataset: Dataset) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.deps.records.withDatasetLock(
        { datasetId: dataset.id, projectId: dataset.projectId },
        async (records) => {
          assertColumnsCurrent({ columns, columnTypes: await records.columnTypes() });
          return write(records);
        },
      );
    } catch (error) {
      if (!(error instanceof DatasetRecordsTableWriteRefusedError)) throw error;
      const current = await this.deps.current(dataset);
      const content = this.deps.contentOf(current);
      if (content === undefined) throw error;
      return moved(content, current);
    }
  }
}

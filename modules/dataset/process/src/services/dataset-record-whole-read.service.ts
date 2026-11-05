/** Reading every Postgres row of a dataset in pages, stopping once the byte budget is spent. */
import type {
  Dataset,
  DatasetEntrySelection,
  DatasetRecord,
  DatasetRecordPage,
  DatasetWithRecords,
} from "@langwatch/dataset-contract";

import { entryBytesOf } from "../rules/dataset-row-limits.rules.ts";
import {
  limitDatasetRecordsByBytes,
  selectDatasetRecords,
} from "../rules/dataset-selection.rules.ts";

/** How many postgres-backed rows a whole read asks for at a time. */
const WHOLE_READ_PAGE_ROWS = 200;

type DatasetRecordWholeReadDeps = {
  readPage: (input: {
    slugOrId: string;
    projectId: string;
    page: number;
    limit: number;
  }) => Promise<DatasetRecordPage>;
};

export class DatasetRecordWholeReadService {
  static create(deps: DatasetRecordWholeReadDeps): DatasetRecordWholeReadService {
    return new DatasetRecordWholeReadService(deps);
  }

  private constructor(private readonly deps: DatasetRecordWholeReadDeps) {}

  async readAll({
    slugOrId,
    projectId,
    entrySelection,
    dataset,
    limitBytes,
  }: {
    slugOrId: string;
    projectId: string;
    entrySelection: DatasetEntrySelection;
    dataset: Dataset;
    limitBytes: number;
  }): Promise<DatasetWithRecords> {
    // Only a read of every row can stop early; picking one row needs them all.
    const stopAtBytes = entrySelection === "all" ? limitBytes : null;
    const records: DatasetRecord[] = [];
    let bytes = 0;
    let total = 0;
    let page = 1;
    let hasMoreRecords = true;
    while (hasMoreRecords) {
      const result = await this.deps.readPage({
        slugOrId,
        projectId,
        page,
        limit: WHOLE_READ_PAGE_ROWS,
      });
      total = result.pagination.total;
      for (const record of result.data) {
        bytes += entryBytesOf(record.entry);
        if (stopAtBytes !== null && bytes > stopAtBytes) {
          return {
            dataset,
            records,
            truncated: true,
            totalRows: Math.max(total, records.length + 1),
          };
        }
        records.push(record);
      }
      const lastPage = result.data.length < WHOLE_READ_PAGE_ROWS;
      const readAllRecords = records.length >= total;
      hasMoreRecords = !lastPage && !readAllRecords;

      page += 1;
    }

    const selected = selectDatasetRecords(records, entrySelection);
    const limited = limitDatasetRecordsByBytes(selected, limitBytes);

    return {
      dataset,
      records: limited.records,
      truncated: limited.truncated,
      totalRows: selected.length,
    };
  }
}

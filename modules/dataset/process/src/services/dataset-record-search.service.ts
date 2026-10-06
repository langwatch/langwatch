/** Finding a dataset's rows by the text their cells hold, on either storage layout. */
import {
  DatasetTooLargeToSearchError,
  type Dataset,
  type DatasetRecord,
  type DatasetRecordPage,
} from "@langwatch/dataset-contract";

import {
  DATASET_SEARCH_SCAN_BATCH,
  matchesDatasetSearch,
  type DatasetSearchCaps,
} from "../rules/dataset-search.rules.ts";
import type { DatasetRequestBoundsService } from "./dataset-request-bounds.service.ts";
import type { DatasetServiceOptions } from "./dataset.service.ts";

type DatasetSearchPageInput = { projectId: string; page: number; limit: number };

type DatasetRecordSearchDeps = {
  records: DatasetServiceOptions["records"];
  content: DatasetServiceOptions["content"];
  requestBounds: Pick<DatasetRequestBoundsService, "limit">;
};

export class DatasetRecordSearchService {
  static create(deps: DatasetRecordSearchDeps): DatasetRecordSearchService {
    return new DatasetRecordSearchService(deps);
  }

  private constructor(private readonly deps: DatasetRecordSearchDeps) {}

  /** The rows and bytes one search may read, as the project's organization answers them. */
  private async searchCaps(projectId: string): Promise<DatasetSearchCaps> {
    const [maxRows, maxBytes] = await Promise.all([
      this.deps.requestBounds.limit(projectId, "rowsMax"),
      this.deps.requestBounds.limit(projectId, "wholeReadBytes"),
    ]);

    return { maxRows, maxBytes };
  }

  /** One page of the rows whose cells hold the search text, refused past what a search may read. */
  async searchRecords({
    dataset,
    input,
    search,
  }: {
    dataset: Dataset;
    input: DatasetSearchPageInput;
    search: string;
  }): Promise<DatasetRecordPage> {
    const caps = await this.searchCaps(input.projectId);
    const recordedRows = dataset.rowCount ?? 0;
    if (recordedRows > caps.maxRows) {
      throw new DatasetTooLargeToSearchError({
        rowCount: recordedRows,
        maxRows: caps.maxRows,
      });
    }
    if (dataset.sizeBytes !== null && dataset.sizeBytes > BigInt(caps.maxBytes)) {
      throw new DatasetTooLargeToSearchError({
        sizeBytes: Number(dataset.sizeBytes),
        maxBytes: caps.maxBytes,
      });
    }

    if (dataset.contentLayout === "s3_jsonl" && this.deps.content) {
      return this.deps.content.searchRecords({
        dataset,
        projectId: input.projectId,
        page: input.page,
        limit: input.limit,
        search,
        caps,
      });
    }

    const storedRows = await this.deps.records.count({
      datasetId: dataset.id,
      projectId: input.projectId,
    });
    if (storedRows > caps.maxRows) {
      throw new DatasetTooLargeToSearchError({
        rowCount: storedRows,
        maxRows: caps.maxRows,
      });
    }

    const page = input.page;
    const limit = input.limit;
    const windowStart = (page - 1) * limit;
    const windowEnd = windowStart + limit;
    const matches: DatasetRecord[] = [];
    let matched = 0;
    await this.scanPostgresRecords({
      dataset,
      projectId: input.projectId,
      maxRows: caps.maxRows,
      collect: (record) => {
        if (!matchesDatasetSearch({ entry: record.entry, search })) return;
        if (matched >= windowStart && matched < windowEnd) matches.push(record);
        matched++;
      },
    });

    return {
      data: matches,
      pagination: {
        page,
        limit,
        total: matched,
        totalPages: matched === 0 ? 0 : Math.ceil(matched / limit),
      },
    };
  }

  private async scanPostgresRecords(input: {
    dataset: Dataset;
    projectId: string;
    maxRows: number;
    collect: (record: DatasetRecord) => void;
  }): Promise<void> {
    let rowsRead = 0;
    let cursorId: string | undefined;
    while (rowsRead <= input.maxRows) {
      const records = await this.deps.records.findPage({
        datasetId: input.dataset.id,
        projectId: input.projectId,
        limit: DATASET_SEARCH_SCAN_BATCH,
        cursorId,
      });
      rowsRead += records.length;
      if (rowsRead > input.maxRows) {
        throw new DatasetTooLargeToSearchError({
          rowCount: rowsRead,
          maxRows: input.maxRows,
        });
      }
      records.forEach(input.collect);
      if (records.length < DATASET_SEARCH_SCAN_BATCH) return;
      cursorId = records.at(-1)?.id;
      if (!cursorId) return;
    }
  }
}

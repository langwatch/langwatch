import type { Dataset, DatasetRecord, DatasetWithRecords } from "@langwatch/dataset-contract";

import type { DatasetChunkRepository } from "../repositories/dataset-chunk.repository.ts";
import { isChunkLine } from "../rules/dataset-chunk-lines.rules.ts";
import { entryBytesOf } from "../rules/dataset-row-limits.rules.ts";

/** Reads rows out of a dataset stored as s3_jsonl chunks, one chunk in memory at a time. */
export class DatasetChunkReadService {
  private constructor() {}

  static create(): DatasetChunkReadService {
    return new DatasetChunkReadService();
  }

  /** The entries of the named rows, read chunk by chunk until every id is found. */
  async findEntries({
    dataset,
    projectId,
    ids,
    storage,
  }: {
    dataset: Pick<Dataset, "id" | "chunkCount">;
    projectId: string;
    ids: readonly string[];
    storage: DatasetChunkRepository;
  }): Promise<Record<string, unknown>[]> {
    const remaining = new Set(ids);
    const entries: Record<string, unknown>[] = [];
    const chunkCount = dataset.chunkCount ?? 0;
    for (let index = 0; index < chunkCount && remaining.size > 0; index++) {
      const rows = await storage.readChunk({ projectId, datasetId: dataset.id, index });
      for (const line of rows) {
        if (!isChunkLine(line) || !remaining.has(line.id)) continue;
        remaining.delete(line.id);
        if (typeof line.entry === "object" && line.entry !== null) {
          entries.push({ ...line.entry });
        }
      }
    }

    return entries;
  }

  /**
   * Every row in order until the byte budget is spent. The read stops at the
   * first row that does not fit, and reports rows left out instead of skipping it.
   */
  async readWithinBudget({
    dataset,
    limitBytes,
    storage,
    toRecord,
  }: {
    dataset: Dataset;
    limitBytes: number;
    storage: DatasetChunkRepository;
    toRecord: (line: unknown) => DatasetRecord;
  }): Promise<DatasetWithRecords> {
    const { projectId } = dataset;
    const records: DatasetRecord[] = [];
    let bytes = 0;
    let rowsSeen = 0;
    for (let index = 0; index < (dataset.chunkCount ?? 0); index++) {
      const lines = await storage.readChunk({ projectId, datasetId: dataset.id, index });
      for (const line of lines) {
        rowsSeen += 1;
        const record = toRecord(line);
        bytes += entryBytesOf(record.entry);
        if (bytes > limitBytes) {
          const totalRows = Math.max(dataset.rowCount ?? 0, rowsSeen);

          return { dataset, records, truncated: true, totalRows };
        }
        records.push(record);
      }
    }

    return { dataset, records, truncated: false, totalRows: records.length };
  }
}

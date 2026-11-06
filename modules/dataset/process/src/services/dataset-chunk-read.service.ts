import type { Dataset, DatasetRecord, DatasetWithRecords } from "@langwatch/dataset-contract";
import { createLogger } from "@langwatch/observability";

import type { DatasetChunkRepository } from "../repositories/dataset-chunk.repository.ts";
import { type ChunkLine, isChunkLine } from "../rules/dataset-chunk-lines.rules.ts";
import { entryBytesOf } from "../rules/dataset-row-limits.rules.ts";

const logger = createLogger("langwatch:datasets:mutations");

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
    const records = await this.findRecords({ dataset, projectId, ids, storage });
    return records.flatMap(({ entry }) => {
      if (typeof entry === "object" && entry !== null) return [{ ...entry }];
      return [];
    });
  }

  async findRecords({
    dataset,
    projectId,
    ids,
    storage,
  }: {
    dataset: Pick<Dataset, "id" | "chunkCount">;
    projectId: string;
    ids: readonly string[];
    storage: DatasetChunkRepository;
  }): Promise<ChunkLine[]> {
    const remaining = new Set(ids);
    const records: ChunkLine[] = [];
    const chunkCount = dataset.chunkCount ?? 0;
    for (let index = 0; index < chunkCount && remaining.size > 0; index++) {
      const rows = await storage.readChunk({ projectId, datasetId: dataset.id, index });
      for (const line of rows) {
        if (!isChunkLine(line) || !remaining.has(line.id)) continue;
        remaining.delete(line.id);
        records.push(line);
      }
    }

    return records;
  }

  /** Pre-lock hints are revalidated by the mutation while it holds the dataset lock. */
  async locateIds({
    storage,
    projectId,
    datasetId,
    ids,
    chunkCount,
  }: {
    storage: DatasetChunkRepository;
    projectId: string;
    datasetId: string;
    ids: Set<string>;
    chunkCount: number;
  }): Promise<
    | { outcome: "located"; affectedIndices: number[]; locatedIds: Set<string> }
    | { outcome: "unavailable" }
  > {
    const affected = new Set<number>();
    const locatedIds = new Set<string>();
    const remaining = new Set(ids);
    for (let index = 0; index < chunkCount && remaining.size > 0; index++) {
      let rows: unknown[];
      try {
        rows = await storage.readChunk({ projectId, datasetId, index });
      } catch {
        logger.warn(
          { projectId, datasetId, index },
          "off-lock chunk read failed during id locate; abandoning fast-path hint, falling back to full in-lock scan",
        );

        return { outcome: "unavailable" };
      }

      for (const line of rows) {
        if (isChunkLine(line) && remaining.has(line.id)) {
          affected.add(index);
          locatedIds.add(line.id);
          remaining.delete(line.id);
        }
      }
    }

    return {
      outcome: "located",
      affectedIndices: [...affected].toSorted((a, b) => a - b),
      locatedIds,
    };
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

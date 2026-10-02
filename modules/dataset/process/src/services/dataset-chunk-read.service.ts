import type { Dataset } from "@langwatch/dataset-contract";

import type { DatasetChunkRepository } from "../repositories/dataset-chunk.repository.ts";
import { isChunkLine } from "../rules/dataset-chunk-lines.rules.ts";

/** Reads named rows out of a dataset stored as s3_jsonl chunks. */
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
}

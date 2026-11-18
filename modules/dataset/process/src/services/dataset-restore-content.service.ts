import {
  type Dataset,
  type DatasetColumns,
  DatasetRecordsTableWriteRefusedError,
  type DatasetVersionRow,
} from "@langwatch/dataset-contract";
import { createLogger } from "@langwatch/observability";

import type { DatasetChunkRepository } from "../repositories/dataset-chunk.repository.ts";
import type { DatasetContentRepository } from "../repositories/dataset-content.repository.ts";
import type { DatasetRecordRepository } from "../repositories/dataset-record.repository.ts";
import { StreamingChunkWriterService } from "./dataset-chunk-writer.service.ts";

const logger = createLogger("langwatch:dataset:versions");

/**
 * Writes a restored version as the dataset's content. A records-table dataset keeps it in the
 * table, where the content move's change check sees it; chunks are written only for a dataset
 * already in object storage, so the move never races a second chunk writer (write-paths.feature).
 */
export class DatasetRestoreContentService {
  static create(deps: {
    content: DatasetContentRepository;
    records: DatasetRecordRepository;
    chunks: DatasetChunkRepository;
  }): DatasetRestoreContentService {
    return new DatasetRestoreContentService(deps);
  }

  private constructor(
    private readonly deps: {
      content: DatasetContentRepository;
      records: DatasetRecordRepository;
      chunks: DatasetChunkRepository;
    },
  ) {}

  async replace({
    dataset,
    columns,
    rows,
  }: {
    dataset: Dataset;
    columns: DatasetColumns;
    rows: readonly DatasetVersionRow[];
  }): Promise<void> {
    const { projectId, id: datasetId } = dataset;
    if (dataset.contentLayout === "s3_jsonl")
      return this.#replaceChunks({ dataset, columns, rows });

    const entries = rows.map((row) => ({ ...row.entry, id: row.id }));
    try {
      await this.deps.records.withDatasetLock({ datasetId, projectId }, async (records) => {
        await records.replaceAll({ datasetId, projectId, entries });
        await records.setColumnTypes(columns);
      });
    } catch (error) {
      // The move flipped the dataset while the restore waited for its lock: write the chunks.
      if (!(error instanceof DatasetRecordsTableWriteRefusedError)) throw error;
      const current = await this.deps.content.getOne({ id: datasetId, projectId });
      if (current.contentLayout !== "s3_jsonl") throw error;
      return this.#replaceChunks({ dataset, columns, rows });
    }
    logger.info({ projectId, datasetId, rows: rows.length }, "Restored a dataset version in place");
  }

  async #replaceChunks({
    dataset: { projectId, id: datasetId },
    columns,
    rows,
  }: {
    dataset: Dataset;
    columns: DatasetColumns;
    rows: readonly DatasetVersionRow[];
  }): Promise<void> {
    await this.deps.content.withDatasetLock(datasetId, async (tx) => {
      const writer = StreamingChunkWriterService.create({
        storage: this.deps.chunks,
        projectId,
        datasetId,
      });
      for (const row of rows) await writer.push(row.entry, { id: row.id });
      const meta = await writer.finalize();
      await tx.updateContent({
        id: datasetId,
        projectId,
        content: {
          rowCount: meta.rowCount,
          sizeBytes: BigInt(meta.sizeBytes),
          chunkCount: meta.chunkCount,
          chunkOffsets: meta.chunkOffsets,
          columnTypes: columns,
        },
      });
      // Still under the lock, so no append lands past the new count first; a failed update
      // above leaves these chunks, which the dataset still names.
      await this.deps.chunks.deleteChunksFrom({ projectId, datasetId, fromIndex: meta.chunkCount });
    });
  }
}

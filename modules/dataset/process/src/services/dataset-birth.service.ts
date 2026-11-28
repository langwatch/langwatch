import { type Dataset, DuplicateRecordIdError } from "@langwatch/dataset-contract";
import { generate } from "@langwatch/ksuid";

import type { DatasetSeedRow } from "../app/dataset.app.ts";
import type { DatasetChunkRepository } from "../repositories/dataset-chunk.repository.ts";
import type { DatasetContentRepository } from "../repositories/dataset-content.repository.ts";
import type { DatasetRow } from "../repositories/dataset.repository.ts";
import { assertStoredRowWithinLimit } from "../rules/dataset-row-limits.rules.ts";
import { stripNullBytes } from "../rules/dataset-sanitize.rules.ts";
import { StreamingChunkWriterService } from "./dataset-chunk-writer.service.ts";
import type { DatasetChunkService } from "./dataset-chunk.service.ts";

/** The app's KSUID resource for a dataset row (`KSUID_RESOURCES.DATASET`), as uploads write it. */
const DATASET_KSUID_RESOURCE = "dataset";

/**
 * Born on storage (ADR-032 v13): a new dataset's rows go to chunks one chunk at a
 * time BEFORE its row exists, so a failed write leaves no dataset. What was written
 * is reaped, unless a failed row insert may have committed after all.
 */
export class DatasetBirthService {
  static create(options: {
    datasets: DatasetContentRepository;
    storage: DatasetChunkRepository;
    chunks: Pick<DatasetChunkService, "deleteAllChunks">;
  }): DatasetBirthService {
    return new DatasetBirthService(options.datasets, options.storage, options.chunks);
  }

  private constructor(
    private readonly datasets: DatasetContentRepository,
    private readonly storage: DatasetChunkRepository,
    private readonly chunks: Pick<DatasetChunkService, "deleteAllChunks">,
  ) {}

  async createDataset({
    projectId,
    name,
    slug,
    columnTypes,
    rows,
  }: {
    projectId: string;
    name: string;
    slug: string;
    columnTypes: Dataset["columnTypes"];
    rows: AsyncIterable<DatasetSeedRow> | Iterable<DatasetSeedRow>;
  }): Promise<DatasetRow> {
    const datasetId = generate(DATASET_KSUID_RESOURCE).toString();
    const writer = StreamingChunkWriterService.create({
      storage: this.storage,
      projectId,
      datasetId,
    });
    const pinnedIds = new Set<string>();
    let written: Awaited<ReturnType<StreamingChunkWriterService["finalize"]>>;
    try {
      for await (const row of rows) {
        assertStoredRowWithinLimit(row.entry);
        if (row.id !== undefined) {
          if (pinnedIds.has(row.id)) throw new DuplicateRecordIdError(row.id);
          pinnedIds.add(row.id);
        }
        await writer.push(stripNullBytes(row.entry), row.id === undefined ? {} : { id: row.id });
      }
      written = await writer.finalize();
    } catch (error) {
      await this.discardChunks({ projectId, datasetId });
      throw error;
    }

    try {
      return await this.datasets.create({
        id: datasetId,
        projectId,
        name,
        slug,
        columnTypes,
        contentLayout: "s3_jsonl",
        status: "ready",
        rowCount: written.rowCount,
        sizeBytes: BigInt(written.sizeBytes),
        chunkCount: written.chunkCount,
        chunkOffsets: written.chunkOffsets,
      });
    } catch (error) {
      await this.discardChunksUnlessSaved({ projectId, datasetId });
      throw error;
    }
  }

  /** A failed insert may still have committed: its chunks go only once the row is known absent. */
  private async discardChunksUnlessSaved(input: {
    projectId: string;
    datasetId: string;
  }): Promise<void> {
    const absent = await this.datasets
      .findOne({ id: input.datasetId, projectId: input.projectId })
      .then(
        (row) => row === null,
        () => false,
      );
    if (absent) await this.discardChunks(input);
  }

  /** Best-effort: a failed reap must not hide the failure that caused it. */
  private async discardChunks(input: { projectId: string; datasetId: string }): Promise<void> {
    try {
      await this.chunks.deleteAllChunks({ ...input, storage: this.storage });
    } catch (error) {
      if (!(error instanceof Error)) throw error;
    }
  }
}

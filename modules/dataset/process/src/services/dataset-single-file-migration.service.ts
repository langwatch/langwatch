import { createLogger } from "@langwatch/observability";

import type { DatasetChunkRepository } from "../repositories/dataset-chunk.repository.ts";
import type { DatasetMigrationRepository } from "../repositories/dataset-migration.repository.ts";
import type { DatasetSingleFileRepository } from "../repositories/dataset-single-file.repository.ts";
import { parseSingleFileRecords } from "../rules/dataset-single-file.rules.ts";
import { StreamingChunkWriterService } from "./dataset-chunk-writer.service.ts";

const logger = createLogger("langwatch:dataset:migration");

export type SingleFileOutcome =
  | "converted"
  | "would-convert"
  | "already-migrated"
  | "missing"
  | "unreadable";

/**
 * Copies one of the previous release's single-file datasets (`useS3`) into
 * today's chunks and flips its layout. The source file is never changed, and
 * a missing or unreadable one is left for the operator rather than failing.
 */
export class DatasetSingleFileMigrationService {
  static create(options: {
    repository: DatasetMigrationRepository;
    storage: DatasetChunkRepository;
    singleFiles: DatasetSingleFileRepository;
  }): DatasetSingleFileMigrationService {
    return new DatasetSingleFileMigrationService(
      options.repository,
      options.storage,
      options.singleFiles,
    );
  }

  private constructor(
    private readonly repository: DatasetMigrationRepository,
    private readonly storage: DatasetChunkRepository,
    private readonly singleFiles: DatasetSingleFileRepository,
  ) {}

  async convertDataset({
    datasetId,
    projectId,
    dryRun,
  }: {
    datasetId: string;
    projectId: string;
    dryRun?: boolean;
  }): Promise<SingleFileOutcome> {
    const input = { datasetId, projectId };
    if (!(await this.repository.isSingleFileLayout(input))) return "already-migrated";

    const file = await this.singleFiles.getSingleFile(input);
    if (file.outcome === "missing") {
      logger.warn(input, "Single-file dataset has no file to copy; left in place");
      return "missing";
    }
    const parsed = parseSingleFileRecords(file.text);
    if (parsed.outcome === "unreadable") {
      logger.warn(input, "Single-file dataset's file is not a record array; left in place");
      return "unreadable";
    }
    if (dryRun) return "would-convert";

    const writer = StreamingChunkWriterService.create({ storage: this.storage, ...input });
    for (const record of parsed.records) {
      await writer.push(record.entry, record.id === undefined ? undefined : { id: record.id });
    }
    const metadata = await writer.finalize();
    await this.storage.deleteChunksFrom({ ...input, fromIndex: metadata.chunkCount });

    const committed = await this.repository.commitSingleFile({ ...input, metadata });
    return committed === "migrated" ? "converted" : "already-migrated";
  }
}

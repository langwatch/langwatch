import { createLogger } from "@langwatch/observability";

import type { DatasetChunkRepository } from "../repositories/dataset-chunk.repository.ts";
import type {
  DatasetMigrationOutcome,
  DatasetMigrationRepository,
  DatasetMigrationRunResult,
  DatasetMigrationSummary,
} from "../repositories/dataset-migration.repository.ts";
import { StreamingChunkWriterService } from "./dataset-chunk-writer.service.ts";

const logger = createLogger("langwatch:dataset:migration");
const DATASET_PAGE_SIZE = 50;
const RECORD_PAGE_SIZE = 1000;

/**
 * The one-off move of postgres-layout dataset content into object-storage
 * chunks: walks every project's postgres datasets, streams each one's records
 * into chunks, and commits the flip only when no record changed meanwhile.
 */
export class DatasetMigrationService {
  static create(options: {
    repository: DatasetMigrationRepository;
    storage: DatasetChunkRepository;
  }): DatasetMigrationService {
    return new DatasetMigrationService(options.repository, options.storage);
  }

  private constructor(
    private readonly repository: DatasetMigrationRepository,
    private readonly storage: DatasetChunkRepository,
  ) {}

  async run(input: { dryRun?: boolean } = {}): Promise<DatasetMigrationRunResult> {
    try {
      return { status: "completed", summary: await this.migrateAll(input) };
    } catch (error) {
      if (this.repository.isSchemaPending(error)) return { status: "schema-pending" };
      throw error;
    }
  }

  async migrateDataset(
    input: { datasetId: string; projectId: string },
    options: { dryRun?: boolean } = {},
  ): Promise<DatasetMigrationOutcome> {
    if (options.dryRun) {
      logger.info(input, "[dry-run] would migrate dataset content to chunked JSONL");
      return "would-migrate";
    }

    if (!(await this.repository.isPostgresLayout(input))) return "already-migrated";

    const baseline = await this.repository.getFingerprint(input);
    const metadata = await this.writeChunks(input);
    await this.storage.deleteChunksFrom({ ...input, fromIndex: metadata.chunkCount });

    return this.repository.commit({ ...input, baseline, metadata });
  }

  private async writeChunks(input: { datasetId: string; projectId: string }) {
    const writer = StreamingChunkWriterService.create({ storage: this.storage, ...input });

    let afterId: string | undefined;
    let page: { id: string; entry: unknown }[];
    do {
      page = await this.repository.findRecordPage({ ...input, afterId, limit: RECORD_PAGE_SIZE });
      for (const row of page) {
        await writer.push(row.entry, { id: row.id });
      }
      afterId = page.at(-1)?.id;
    } while (page.length > 0);

    return writer.finalize();
  }

  private async migrateAll(input: { dryRun?: boolean }): Promise<DatasetMigrationSummary> {
    const summary: DatasetMigrationSummary = {
      migrated: 0,
      wouldMigrate: 0,
      alreadyMigrated: 0,
      skippedConcurrentWrite: 0,
      failed: 0,
    };

    for (const projectId of await this.repository.findProjectIds()) {
      let afterId: string | undefined;
      let page: string[];
      do {
        page = await this.repository.findPostgresDatasetIds({
          projectId,
          afterId,
          limit: DATASET_PAGE_SIZE,
        });
        await this.migratePage({ projectId, page, input, summary });
        afterId = page.at(-1);
      } while (page.length > 0);
    }

    return summary;
  }

  /** Migrates one page of datasets, counting each outcome; a failed one waits for a later run. */
  private async migratePage({
    projectId,
    page,
    input,
    summary,
  }: {
    projectId: string;
    page: string[];
    input: { dryRun?: boolean };
    summary: DatasetMigrationSummary;
  }): Promise<void> {
    for (const datasetId of page) {
      try {
        increment(summary, await this.migrateDataset({ datasetId, projectId }, input));
      } catch (error) {
        summary.failed += 1;
        logger.warn(
          { error, datasetId, projectId },
          "Dataset migration failed; a later run can retry it",
        );
      }
    }
  }
}

function increment(summary: DatasetMigrationSummary, outcome: DatasetMigrationOutcome): void {
  if (outcome === "migrated") summary.migrated += 1;
  if (outcome === "would-migrate") summary.wouldMigrate += 1;
  if (outcome === "already-migrated") summary.alreadyMigrated += 1;
  if (outcome === "skipped-concurrent-write") summary.skippedConcurrentWrite += 1;
}

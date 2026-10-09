import { createLogger } from "@langwatch/observability";
import { PROJECT_ID_PAGE_LIMIT, type ProjectApi } from "@langwatch/project-contract";
import type { MigrationStepReport, MigrationStepRun } from "@langwatch/upgrade/step";

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

type MigrationProjects = Pick<ProjectApi, "listAllIds">;

/** Where a resumed run starts, and what it hears after each project it finished. */
type MigrationRunInput = {
  dryRun?: boolean;
  /** Projects up to and including this id are skipped: the last finished one. */
  afterProjectId?: string | undefined;
  /** Stops between datasets; a project cut short is not reported finished. */
  signal?: AbortSignal;
  onProjectDone?: (progress: { afterProjectId: string }) => Promise<void>;
};

/**
 * The one-off move of postgres-layout dataset content into object-storage
 * chunks: walks every project's postgres datasets, streams each one's records
 * into chunks, and commits the flip only when no record changed meanwhile.
 */
export class DatasetMigrationService {
  static create(options: {
    repository: DatasetMigrationRepository;
    storage: DatasetChunkRepository;
    /** The owner of the project table, which names every project the scan walks. */
    projects: MigrationProjects;
  }): DatasetMigrationService {
    return new DatasetMigrationService(options.repository, options.storage, options.projects);
  }

  private constructor(
    private readonly repository: DatasetMigrationRepository,
    private readonly storage: DatasetChunkRepository,
    private readonly projects: MigrationProjects,
  ) {}

  async run(input: MigrationRunInput = {}): Promise<DatasetMigrationRunResult> {
    try {
      const summary = await this.migrateAll(input);
      return { status: remaining(summary) > 0 ? "incomplete" : "completed", summary };
    } catch (error) {
      if (this.repository.isSchemaPending(error)) return { status: "schema-pending" };
      throw error;
    }
  }

  /**
   * The background step's run. The framework records a normal return done, so work left
   * behind (a failed or concurrently changed dataset) throws: the step retries from its checkpoint.
   */
  async runStep({
    checkpoint,
    dryRun,
    signal,
  }: Parameters<MigrationStepRun>[0]): Promise<MigrationStepReport> {
    const resumed = checkpoint.resumeFrom?.afterProjectId;
    const result = await this.run({
      dryRun,
      signal,
      afterProjectId: typeof resumed === "string" ? resumed : undefined,
      onProjectDone: (progress) =>
        dryRun ? Promise.resolve() : checkpoint.save({ report: progress }),
    });
    if (result.status === "schema-pending") {
      throw new Error("Dataset chunk-layout columns are not applied yet; the step retries");
    }
    if (result.status === "incomplete") {
      const { failed, skippedConcurrentWrite } = result.summary;
      throw new Error(
        `${failed} datasets failed and ${skippedConcurrentWrite} changed while moving; the step retries`,
      );
    }
    return { ...result.summary, dryRun };
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

  private async migrateAll(input: MigrationRunInput): Promise<DatasetMigrationSummary> {
    const summary: DatasetMigrationSummary = {
      migrated: 0,
      wouldMigrate: 0,
      alreadyMigrated: 0,
      skippedConcurrentWrite: 0,
      failed: 0,
    };

    let after = input.afterProjectId;
    do {
      const projects = await this.projects.listAllIds({ after, limit: PROJECT_ID_PAGE_LIMIT });
      for (const projectId of projects.ids) {
        if (input.signal?.aborted) return summary;
        await this.migrateProject({ projectId, input, summary });
        if (input.signal?.aborted) return summary;
        // Once any dataset is left behind, the cursor stays before it for the retry.
        if (remaining(summary) === 0) await input.onProjectDone?.({ afterProjectId: projectId });
      }
      after = projects.next ?? undefined;
    } while (after !== undefined);

    return summary;
  }

  private async migrateProject({
    projectId,
    input,
    summary,
  }: {
    projectId: string;
    input: MigrationRunInput;
    summary: DatasetMigrationSummary;
  }): Promise<void> {
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
    } while (page.length > 0 && !input.signal?.aborted);
  }

  /** Migrates one page of datasets, counting each outcome; a failed one is left for the retry. */
  private async migratePage({
    projectId,
    page,
    input,
    summary,
  }: {
    projectId: string;
    page: string[];
    input: MigrationRunInput;
    summary: DatasetMigrationSummary;
  }): Promise<void> {
    for (const datasetId of page) {
      if (input.signal?.aborted) return;
      try {
        increment(summary, await this.migrateDataset({ datasetId, projectId }, input));
      } catch (error) {
        summary.failed += 1;
        logger.warn(
          { error, datasetId, projectId },
          "Dataset migration failed; the run ends incomplete and retries it",
        );
      }
    }
  }
}

/** Datasets this run left on the postgres layout: failed or changed while moving. */
function remaining(summary: DatasetMigrationSummary): number {
  return summary.failed + summary.skippedConcurrentWrite;
}

function increment(summary: DatasetMigrationSummary, outcome: DatasetMigrationOutcome): void {
  if (outcome === "migrated") summary.migrated += 1;
  if (outcome === "would-migrate") summary.wouldMigrate += 1;
  if (outcome === "already-migrated") summary.alreadyMigrated += 1;
  if (outcome === "skipped-concurrent-write") summary.skippedConcurrentWrite += 1;
}

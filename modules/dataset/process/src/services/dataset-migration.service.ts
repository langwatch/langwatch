import { createLogger } from "@langwatch/observability";
import { PROJECT_ID_PAGE_LIMIT, type ProjectApi } from "@langwatch/project-contract";
import type { MigrationStepReport, MigrationStepRun } from "@langwatch/upgrade/step";
import { z } from "zod";

import type { DatasetChunkRepository } from "../repositories/dataset-chunk.repository.ts";
import type {
  DatasetMigrationOutcome,
  DatasetMigrationRepository,
  DatasetMigrationRunResult,
  DatasetMigrationSummary,
  DatasetMoveNotes,
} from "../repositories/dataset-migration.repository.ts";
import {
  carriedCount,
  carriedList,
  resumedStepProgress,
  savingProgressOnThrow,
  stepProgressReport,
} from "../rules/dataset-step-progress.rules.ts";
import { StreamingChunkWriterService } from "./dataset-chunk-writer.service.ts";

const logger = createLogger("langwatch:dataset:migration");
const DATASET_PAGE_SIZE = 50;
const RECORD_PAGE_SIZE = 1000;

type MigrationProjects = Pick<ProjectApi, "listAllIds">;

/** The totals of moved datasets a retried step carries; failures count the last attempt only. */
const carriedMoveSchema = z.object({
  migrated: carriedCount,
  alreadyMigrated: carriedCount,
  archived: carriedCount,
  empty: carriedCount,
  rowsUnderOtherProject: carriedList(
    z.object({ datasetId: z.string(), projectId: z.string(), rows: z.number() }),
  ),
});
type CarriedMove = z.infer<typeof carriedMoveSchema>;

/** Where a resumed run starts, the totals it carries, and what it hears after each project. */
type MigrationRunInput = {
  dryRun?: boolean;
  /** Projects up to and including this id are skipped: the last finished one. */
  afterProjectId?: string | undefined;
  carried?: CarriedMove | undefined;
  /** Stops between datasets; a project cut short is not reported finished. */
  signal?: AbortSignal;
  /** After every project, finished or not; the cursor names the last one finished. */
  onProgress?: (progress: {
    afterProjectId: string | undefined;
    summary: DatasetMigrationSummary;
  }) => Promise<void>;
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
    const resumed = resumedStepProgress({
      resumeFrom: checkpoint.resumeFrom,
      totals: carriedMoveSchema,
    });
    const result = await this.run({
      dryRun,
      signal,
      afterProjectId: resumed.afterProjectId,
      carried: dryRun ? undefined : resumed.totals,
      onProgress: ({ afterProjectId, summary }) =>
        dryRun
          ? Promise.resolve()
          : checkpoint.save({
              report: stepProgressReport({
                afterProjectId,
                totals: carriedMoveSchema.parse(summary),
              }),
            }),
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
    return (await this.moveDataset(input, options)).outcome;
  }

  /** The move of one dataset, with what the report says about it once moved. */
  private async moveDataset(
    input: { datasetId: string; projectId: string },
    options: { dryRun?: boolean | undefined },
  ): Promise<{ outcome: DatasetMigrationOutcome; notes?: DatasetMoveNotes; rowCount?: number }> {
    if (options.dryRun) {
      logger.info(input, "[dry-run] would migrate dataset content to chunked JSONL");
      return { outcome: "would-migrate" };
    }

    if (!(await this.repository.isPostgresLayout(input))) return { outcome: "already-migrated" };

    const notes = await this.repository.findMoveNotes(input);
    const baseline = await this.repository.getFingerprint(input);
    const metadata = await this.writeChunks(input);
    await this.storage.deleteChunksFrom({ ...input, fromIndex: metadata.chunkCount });

    const outcome = await this.repository.commit({ ...input, baseline, metadata });
    return { outcome, notes, rowCount: metadata.rowCount };
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
    const carried = carriedMoveSchema.parse(input.carried ?? {});
    const summary: DatasetMigrationSummary = {
      ...carried,
      rowsUnderOtherProject: [...carried.rowsUnderOtherProject],
      wouldMigrate: 0,
      skippedConcurrentWrite: 0,
      failed: 0,
    };

    let after = input.afterProjectId;
    let finished = input.afterProjectId;
    do {
      const projects = await this.projects.listAllIds({ after, limit: PROJECT_ID_PAGE_LIMIT });
      for (const projectId of projects.ids) {
        if (input.signal?.aborted) return summary;
        await savingProgressOnThrow({
          work: () => this.migrateProject({ projectId, input, summary }),
          save: async () => input.onProgress?.({ afterProjectId: finished, summary }),
        });
        // Once any dataset is left behind, the cursor stays before it for the retry.
        if (!input.signal?.aborted && remaining(summary) === 0) finished = projectId;
        await input.onProgress?.({ afterProjectId: finished, summary });
        if (input.signal?.aborted) return summary;
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
        const moved = await this.moveDataset({ datasetId, projectId }, input);
        increment(summary, moved.outcome);
        if (moved.outcome === "migrated") note(summary, { datasetId, projectId }, moved);
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

/** What a moved dataset adds to the report: archived, empty, or rows left under another project. */
function note(
  summary: DatasetMigrationSummary,
  key: { datasetId: string; projectId: string },
  moved: { notes?: DatasetMoveNotes; rowCount?: number },
): void {
  if (moved.notes?.archived) summary.archived += 1;
  if (moved.rowCount === 0) summary.empty += 1;
  const rows = moved.notes?.rowsUnderOtherProject ?? 0;
  if (rows > 0) summary.rowsUnderOtherProject.push({ ...key, rows });
}

function increment(summary: DatasetMigrationSummary, outcome: DatasetMigrationOutcome): void {
  if (outcome === "migrated") summary.migrated += 1;
  if (outcome === "would-migrate") summary.wouldMigrate += 1;
  if (outcome === "already-migrated") summary.alreadyMigrated += 1;
  if (outcome === "skipped-concurrent-write") summary.skippedConcurrentWrite += 1;
}

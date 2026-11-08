import { createLogger } from "@langwatch/observability";
import { PROJECT_ID_PAGE_LIMIT, type ProjectApi } from "@langwatch/project-contract";
import type { MigrationStepReport, MigrationStepRun } from "@langwatch/upgrade/step";

import type { DatasetChunkRepository } from "../repositories/dataset-chunk.repository.ts";
import type { DatasetContentRepository } from "../repositories/dataset-content.repository.ts";
import type { DatasetSingleFileConversionRepository } from "../repositories/dataset-single-file-conversion.repository.ts";
import type { DatasetSingleFileRepository } from "../repositories/dataset-single-file.repository.ts";
import { isSingleFileDataset, parseSingleFileRecords } from "../rules/dataset-single-file.rules.ts";
import { StreamingChunkWriterService } from "./dataset-chunk-writer.service.ts";

const logger = createLogger("langwatch:dataset:single-file-conversion");
const DATASET_PAGE_SIZE = 50;

type ConversionProjects = Pick<ProjectApi, "listAllIds">;
type DatasetKey = { datasetId: string; projectId: string };

/** What a run did, and the datasets it left as they were and why. */
export type DatasetSingleFileConversionReport = {
  converted: number;
  wouldConvert: number;
  wouldConvertRecords: number;
  /** Old single files left where they were, for a later operator step to remove. */
  oldFilesLeft: number;
  /** Converted datasets whose recorded count disagreed with the records their file held. */
  wrongRecordedCount: string[];
  /** Left as single-file datasets: a recorded count above zero and no file. */
  missingFile: string[];
  /** Left as single-file datasets: a file that is not a JSON array of records. */
  unreadable: string[];
  failed: string[];
};

type ConversionRunInput = {
  dryRun?: boolean;
  /** Projects up to and including this id are skipped: the last finished one. */
  afterProjectId?: string | undefined;
  signal?: AbortSignal;
  onProjectDone?: (progress: { afterProjectId: string }) => Promise<void>;
};

type ConversionOutcome =
  | { outcome: "converted"; wrongRecordedCount: boolean }
  | { outcome: "would-convert"; records: number }
  | { outcome: "already-converted" | "missing-file" | "unreadable" };

/**
 * The background step that converts the datasets an older release kept as one JSON array into
 * object-storage chunks, under the lock the single-file writer takes. The old file is kept; a
 * dataset whose file is missing or unreadable is left as it was, never emptied.
 */
export class DatasetSingleFileConversionService {
  static create(options: {
    conversion: DatasetSingleFileConversionRepository;
    datasets: DatasetContentRepository;
    files: DatasetSingleFileRepository;
    chunks: DatasetChunkRepository;
    /** The owner of the project table, which names every project the step walks. */
    projects: ConversionProjects;
  }): DatasetSingleFileConversionService {
    return new DatasetSingleFileConversionService(options);
  }

  private constructor(
    private readonly options: {
      conversion: DatasetSingleFileConversionRepository;
      datasets: DatasetContentRepository;
      files: DatasetSingleFileRepository;
      chunks: DatasetChunkRepository;
      projects: ConversionProjects;
    },
  ) {}

  async run(input: ConversionRunInput = {}): Promise<{
    status: "completed" | "incomplete";
    report: DatasetSingleFileConversionReport;
  }> {
    const report = await this.convertAll(input);
    return { status: leftBehind(report) > 0 ? "incomplete" : "completed", report };
  }

  /**
   * The step's run. A normal return records it done, so a dataset left behind throws, naming
   * it: the step retries from its checkpoint, which never passes a project left behind.
   */
  async runStep({
    checkpoint,
    dryRun,
    signal,
  }: Parameters<MigrationStepRun>[0]): Promise<MigrationStepReport> {
    const resumed = checkpoint.resumeFrom?.afterProjectId;
    const { report } = await this.run({
      dryRun,
      signal,
      afterProjectId: typeof resumed === "string" ? resumed : undefined,
      onProjectDone: (progress) =>
        dryRun ? Promise.resolve() : checkpoint.save({ report: progress }),
    });
    const problems = [
      named("have no file but record rows, so they stay single-file datasets", report.missingFile),
      named("are not a JSON array of records", report.unreadable),
      named("failed to convert", report.failed),
    ].filter((problem) => problem !== undefined);
    if (problems.length > 0) {
      throw new Error(`Single-file datasets ${problems.join("; ")}; the step retries`);
    }
    return { ...report, dryRun };
  }

  private async convertAll(input: ConversionRunInput): Promise<DatasetSingleFileConversionReport> {
    const report: DatasetSingleFileConversionReport = {
      converted: 0,
      wouldConvert: 0,
      wouldConvertRecords: 0,
      oldFilesLeft: 0,
      wrongRecordedCount: [],
      missingFile: [],
      unreadable: [],
      failed: [],
    };
    let after = input.afterProjectId;
    do {
      const page = await this.options.projects.listAllIds({ after, limit: PROJECT_ID_PAGE_LIMIT });
      for (const projectId of page.ids) {
        if (input.signal?.aborted) return report;
        await this.convertProject({ projectId, input, report });
        if (input.signal?.aborted) return report;
        if (leftBehind(report) === 0) await input.onProjectDone?.({ afterProjectId: projectId });
      }
      after = page.next ?? undefined;
    } while (after !== undefined);
    return report;
  }

  private async convertProject({
    projectId,
    input,
    report,
  }: {
    projectId: string;
    input: ConversionRunInput;
    report: DatasetSingleFileConversionReport;
  }): Promise<void> {
    let afterId: string | undefined;
    let page: string[];
    do {
      page = await this.options.conversion.findSingleFileDatasetIds({
        projectId,
        afterId,
        limit: DATASET_PAGE_SIZE,
      });
      for (const datasetId of page) {
        if (input.signal?.aborted) return;
        await this.convertCounted({ datasetId, projectId }, input, report);
      }
      // A dataset left behind stays in the selection, so the next page starts after it.
      afterId = page.at(-1);
    } while (page.length > 0 && !input.signal?.aborted);
  }

  private async convertCounted(
    key: DatasetKey,
    input: ConversionRunInput,
    report: DatasetSingleFileConversionReport,
  ): Promise<void> {
    let result: ConversionOutcome;
    try {
      result = await this.convertDataset(key, { dryRun: input.dryRun ?? false });
    } catch (error) {
      logger.warn({ error, ...key }, "Single-file dataset conversion failed; the step retries it");
      report.failed.push(key.datasetId);
      return;
    }
    if (result.outcome === "converted") {
      report.converted += 1;
      report.oldFilesLeft += 1;
      if (result.wrongRecordedCount) report.wrongRecordedCount.push(key.datasetId);
    }
    if (result.outcome === "would-convert") {
      report.wouldConvert += 1;
      report.wouldConvertRecords += result.records;
    }
    if (result.outcome === "missing-file") report.missingFile.push(key.datasetId);
    if (result.outcome === "unreadable") report.unreadable.push(key.datasetId);
  }

  /** Converts one dataset inside its lock, so a write waits and then finds it on chunks. */
  private convertDataset(
    key: DatasetKey,
    options: { dryRun: boolean },
  ): Promise<ConversionOutcome> {
    return this.options.datasets.withDatasetLock(key.datasetId, async (locked) => {
      const current = await locked.findOne({ id: key.datasetId, projectId: key.projectId });
      if (!current || !isSingleFileDataset(current)) return { outcome: "already-converted" };

      const file = await this.options.files.getSingleFile(key);
      if (file.outcome === "too_large") return { outcome: "unreadable" };
      const recordedCount = current.s3RecordCount ?? 0;
      // No file and nothing recorded is a dataset that was never written to: empty, not lost.
      if (file.outcome === "missing" && recordedCount > 0) return { outcome: "missing-file" };
      const parsed =
        file.outcome === "missing"
          ? { outcome: "parsed" as const, records: [] }
          : parseSingleFileRecords(file.text);
      if (parsed.outcome === "unreadable") return { outcome: "unreadable" };
      if (options.dryRun) return { outcome: "would-convert", records: parsed.records.length };

      const writer = StreamingChunkWriterService.create({ storage: this.options.chunks, ...key });
      for (const record of parsed.records) {
        await writer.push(record.entry, record.id === undefined ? undefined : { id: record.id });
      }
      const meta = await writer.finalize();
      await this.options.chunks.deleteChunksFrom({ ...key, fromIndex: meta.chunkCount });
      await locked.update({
        id: key.datasetId,
        projectId: key.projectId,
        data: {
          contentLayout: "s3_jsonl",
          useS3: false,
          rowCount: meta.rowCount,
          sizeBytes: BigInt(meta.sizeBytes),
          chunkCount: meta.chunkCount,
          chunkOffsets: meta.chunkOffsets,
        },
      });
      logger.info(
        { ...key, rowCount: meta.rowCount, chunkCount: meta.chunkCount },
        "Converted single-file dataset to chunked JSONL",
      );
      return { outcome: "converted", wrongRecordedCount: recordedCount !== meta.rowCount };
    });
  }
}

/** Datasets this run left as single-file datasets. */
function leftBehind(report: DatasetSingleFileConversionReport): number {
  return report.missingFile.length + report.unreadable.length + report.failed.length;
}

function named(problem: string, datasetIds: string[]): string | undefined {
  return datasetIds.length > 0 ? `${datasetIds.join(", ")} ${problem}` : undefined;
}

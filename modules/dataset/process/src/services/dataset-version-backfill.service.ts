/**
 * The background step that gives every dataset made before versioning its
 * version 1, one project at a time, checkpointed after each project. It sends
 * no queue work: each snapshot is written in the step's own run.
 */
import {
  DatasetNotFoundError,
  DatasetNotReadyError,
  SYSTEM_DATASET_VERSION_AUTHOR,
} from "@langwatch/dataset-contract";
import { createLogger } from "@langwatch/observability";
import { PROJECT_ID_PAGE_LIMIT, type ProjectApi } from "@langwatch/project-contract";
import type { MigrationStepReport, MigrationStepRun } from "@langwatch/upgrade/step";

import type { DatasetVersionRepository } from "../repositories/dataset-version.repository.ts";
import type { DatasetRepository } from "../repositories/dataset.repository.ts";
import type { DatasetVersionService } from "./dataset-version.service.ts";

const logger = createLogger("langwatch:dataset:version-backfill");

const DATASET_PAGE_SIZE = 50;

type BackfillSummary = { created: number; wouldCreate: number; skipped: number; failed: number };

export class DatasetVersionBackfillService {
  private constructor(
    private readonly deps: {
      datasets: DatasetRepository;
      versions: DatasetVersionRepository;
      service: DatasetVersionService;
      projects: Pick<ProjectApi, "listAllIds">;
    },
  ) {}

  static create(deps: {
    datasets: DatasetRepository;
    versions: DatasetVersionRepository;
    service: DatasetVersionService;
    projects: Pick<ProjectApi, "listAllIds">;
  }): DatasetVersionBackfillService {
    return new DatasetVersionBackfillService(deps);
  }

  async runStep({
    checkpoint,
    dryRun,
    signal,
  }: Parameters<MigrationStepRun>[0]): Promise<MigrationStepReport> {
    const resumed = checkpoint.resumeFrom?.afterProjectId;
    const summary: BackfillSummary = { created: 0, wouldCreate: 0, skipped: 0, failed: 0 };
    let after = typeof resumed === "string" ? resumed : undefined;
    do {
      const projects = await this.deps.projects.listAllIds({ after, limit: PROJECT_ID_PAGE_LIMIT });
      for (const projectId of projects.ids) {
        if (signal.aborted) return { ...summary, dryRun };
        await this.backfillProject({ projectId, dryRun, summary, signal });
        if (signal.aborted) return { ...summary, dryRun };
        // After any failure the cursor stays put, so the retry reaches every failed project.
        if (!dryRun && summary.failed === 0) {
          await checkpoint.save({ report: { ...summary, afterProjectId: projectId } });
        }
      }
      after = projects.next ?? undefined;
    } while (after !== undefined);
    if (summary.failed > 0) {
      throw new Error(`${summary.failed} datasets got no first version; the step retries`);
    }
    return { ...summary, dryRun };
  }

  private async backfillProject({
    projectId,
    dryRun,
    summary,
    signal,
  }: {
    projectId: string;
    dryRun: boolean;
    summary: BackfillSummary;
    signal: AbortSignal;
  }): Promise<void> {
    let afterId: string | undefined;
    let more = true;
    while (more && !signal.aborted) {
      const page = await this.deps.datasets.findStoragePage({
        projectId,
        limit: DATASET_PAGE_SIZE,
        ...(afterId ? { afterId } : {}),
      });
      for (const entry of page) {
        if (signal.aborted) return;
        await this.backfillEntry({ projectId, entry, dryRun, summary });
      }
      more = page.length === DATASET_PAGE_SIZE;
      afterId = page.at(-1)?.id;
    }
  }

  private async backfillEntry({
    projectId,
    entry,
    dryRun,
    summary,
  }: {
    projectId: string;
    entry: { id: string; status: string };
    dryRun: boolean;
    summary: BackfillSummary;
  }): Promise<void> {
    const versioned = await this.deps.versions.hasAny({ projectId, datasetId: entry.id });
    if (entry.status !== "ready" || versioned) {
      summary.skipped += 1;
      return;
    }
    if (dryRun) {
      summary.wouldCreate += 1;
      return;
    }
    await this.backfillDataset({ projectId, datasetId: entry.id, summary });
  }

  private async backfillDataset({
    projectId,
    datasetId,
    summary,
  }: {
    projectId: string;
    datasetId: string;
    summary: BackfillSummary;
  }): Promise<void> {
    try {
      const { created } = await this.deps.service.snapshot({
        projectId,
        datasetId,
        trigger: "initial",
        by: SYSTEM_DATASET_VERSION_AUTHOR,
      });
      if (created) summary.created += 1;
      else summary.skipped += 1;
    } catch (error) {
      if (error instanceof DatasetNotFoundError || error instanceof DatasetNotReadyError) {
        summary.skipped += 1;
        return;
      }
      summary.failed += 1;
      logger.warn(
        { error, projectId, datasetId },
        "A dataset got no first version; the step retries it",
      );
    }
  }
}

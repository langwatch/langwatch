/**
 * The background step that gives a dataset stored with an empty slug the slug its name gives,
 * numbered past one its project holds, one project at a time, checkpointed after each project.
 * A dataset's slug must not be empty, so until then the dataset cannot be read (langwatch#9298).
 */
import { createLogger } from "@langwatch/observability";
import { PROJECT_ID_PAGE_LIMIT, type ProjectApi } from "@langwatch/project-contract";
import type { MigrationStepReport, MigrationStepRun } from "@langwatch/upgrade/step";
import { z } from "zod";

import type { DatasetRepository } from "../repositories/dataset.repository.ts";
import { datasetSlugCandidate } from "../rules/dataset-selection.rules.ts";
import {
  carriedCount,
  resumedStepProgress,
  stepProgressReport,
} from "../rules/dataset-step-progress.rules.ts";

const logger = createLogger("langwatch:dataset:empty-slugs");

const DATASET_PAGE_SIZE = 100;
const MAX_SLUG_ATTEMPTS = 10_000;

type EmptySlugSummary = { filled: number; wouldFill: number; failed: number };
/** The slugs filled that a retried step carries; `failed` counts the last attempt only. */
const carriedFillSchema = z.object({ filled: carriedCount });

export class DatasetEmptySlugService {
  private constructor(
    private readonly deps: {
      datasets: Pick<DatasetRepository, "findEmptySlugPage" | "fillEmptySlug">;
      projects: Pick<ProjectApi, "listAllIds">;
    },
  ) {}

  static create(deps: {
    datasets: Pick<DatasetRepository, "findEmptySlugPage" | "fillEmptySlug">;
    projects: Pick<ProjectApi, "listAllIds">;
  }): DatasetEmptySlugService {
    return new DatasetEmptySlugService(deps);
  }

  async runStep({
    checkpoint,
    dryRun,
    signal,
  }: Parameters<MigrationStepRun>[0]): Promise<MigrationStepReport> {
    const resumed = resumedStepProgress({
      resumeFrom: checkpoint.resumeFrom,
      totals: carriedFillSchema,
    });
    const filled = dryRun ? 0 : resumed.totals.filled;
    const summary: EmptySlugSummary = { filled, wouldFill: 0, failed: 0 };
    let after = resumed.afterProjectId;
    let finished = resumed.afterProjectId;
    do {
      const projects = await this.deps.projects.listAllIds({ after, limit: PROJECT_ID_PAGE_LIMIT });
      for (const projectId of projects.ids) {
        if (signal.aborted) return { ...summary, dryRun };
        // A throw outside the per-dataset catch still saves the totals so far; its error wins.
        await this.fillProject({ projectId, dryRun, summary, signal }).catch(
          async (error: unknown) => {
            await saveProgress({ checkpoint, dryRun, afterProjectId: finished, summary }).catch(
              () => undefined,
            );
            throw error;
          },
        );
        // After any failure the cursor stays before it; the totals are saved regardless.
        if (!signal.aborted && summary.failed === 0) finished = projectId;
        await saveProgress({ checkpoint, dryRun, afterProjectId: finished, summary });
        if (signal.aborted) return { ...summary, dryRun };
      }
      after = projects.next ?? undefined;
    } while (after !== undefined);
    if (summary.failed > 0) {
      throw new Error(`${summary.failed} datasets with an empty slug got none; the step retries`);
    }
    return { ...summary, dryRun };
  }

  private async fillProject({
    projectId,
    dryRun,
    summary,
    signal,
  }: {
    projectId: string;
    dryRun: boolean;
    summary: EmptySlugSummary;
    signal: AbortSignal;
  }): Promise<void> {
    let afterId: string | undefined;
    let more = true;
    while (more && !signal.aborted) {
      const page = await this.deps.datasets.findEmptySlugPage({
        projectId,
        limit: DATASET_PAGE_SIZE,
        ...(afterId ? { afterId } : {}),
      });
      for (const dataset of page) {
        if (dryRun) summary.wouldFill += 1;
        else await this.fillDataset({ projectId, dataset, summary });
      }
      more = page.length === DATASET_PAGE_SIZE;
      afterId = page.at(-1)?.id;
    }
  }

  /** Tries the name's slug, then numbered ones, until the unique slug index takes one. */
  private async fillDataset({
    projectId,
    dataset,
    summary,
  }: {
    projectId: string;
    dataset: { id: string; name: string };
    summary: EmptySlugSummary;
  }): Promise<void> {
    for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt += 1) {
      const slug = datasetSlugCandidate({ name: dataset.name, attempt });
      const outcome = await this.deps.datasets.fillEmptySlug({ id: dataset.id, projectId, slug });
      if (outcome === "filled") summary.filled += 1;
      if (outcome !== "taken") return;
    }
    summary.failed += 1;
    logger.warn(
      { projectId, datasetId: dataset.id },
      "A dataset with an empty slug found no free slug; the step retries it",
    );
  }
}

/** Saves the slugs filled so far and the last finished project; a dry run saves nothing. */
async function saveProgress({
  checkpoint,
  dryRun,
  afterProjectId,
  summary,
}: Pick<Parameters<MigrationStepRun>[0], "checkpoint" | "dryRun"> & {
  afterProjectId: string | undefined;
  summary: EmptySlugSummary;
}): Promise<void> {
  if (dryRun) return;
  await checkpoint.save({ report: stepProgressReport({ afterProjectId, totals: summary }) });
}

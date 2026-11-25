/**
 * Retention over every dataset's history: thins old versions, and purges the history of a
 * dataset that is gone or whose dataset or project was archived 30 days ago.
 * Spec: modules/dataset/specs/dataset-versioning.feature.
 */
import { createLogger } from "@langwatch/observability";

import type { DatasetVersionRepository } from "../repositories/dataset-version.repository.ts";
import type { DatasetRepository } from "../repositories/dataset.repository.ts";
import {
  DATASET_VERSION_ARCHIVED_KEEP_MS,
  DATASET_VERSION_KEEP_ALL_MS,
  versionsToThin,
} from "../rules/dataset-version.rules.ts";
import type { DatasetVersionService } from "./dataset-version.service.ts";

const logger = createLogger("langwatch:dataset:version-retention");

const DATASET_PAGE_SIZE = 100;

export type DatasetVersionRetentionSummary = { datasets: number; thinned: number; purged: number };

export class DatasetVersionRetentionService {
  private constructor(
    private readonly deps: {
      versions: DatasetVersionRepository;
      datasets: DatasetRepository;
      service: DatasetVersionService;
      /** When the project was archived, in epoch ms: null while live, undefined when gone. */
      projectArchivedAt: (projectId: string) => Promise<number | null | undefined>;
    },
  ) {}

  static create(deps: {
    versions: DatasetVersionRepository;
    datasets: DatasetRepository;
    service: DatasetVersionService;
    projectArchivedAt: (projectId: string) => Promise<number | null | undefined>;
  }): DatasetVersionRetentionService {
    return new DatasetVersionRetentionService(deps);
  }

  async sweep({ nowMs }: { nowMs: number }): Promise<DatasetVersionRetentionSummary> {
    const summary: DatasetVersionRetentionSummary = { datasets: 0, thinned: 0, purged: 0 };
    const projects = new Map<string, Promise<number | null | undefined>>();
    let afterDatasetId: string | null = null;
    let more = true;
    while (more) {
      const page = await this.deps.versions.findDatasetsWithVersions({
        afterDatasetId,
        olderThanMs: nowMs - DATASET_VERSION_KEEP_ALL_MS,
        limit: DATASET_PAGE_SIZE,
      });
      for (const { projectId, datasetId } of page) {
        summary.datasets += 1;
        if (await this.#isRetired({ projectId, datasetId, nowMs, projects })) {
          summary.purged += await this.deps.service.purgeDataset({ projectId, datasetId });
        } else {
          summary.thinned += await this.thinDataset({ projectId, datasetId, nowMs });
        }
      }
      more = page.length === DATASET_PAGE_SIZE;
      afterDatasetId = page.at(-1)?.datasetId ?? null;
    }
    if (summary.thinned + summary.purged > 0) {
      logger.info(summary, "Thinned dataset version history");
    }
    return summary;
  }

  async thinDataset(input: {
    projectId: string;
    datasetId: string;
    nowMs: number;
  }): Promise<number> {
    const versions = await this.deps.versions.findAll(input);
    const thinned = new Set(
      versionsToThin({
        nowMs: input.nowMs,
        versions: versions.map((version) => ({
          id: version.id,
          createdAtMs: version.createdAt.getTime(),
          protected: version.name !== null || version.pinned || version.runCount > 0,
        })),
      }),
    );
    if (thinned.size === 0) return 0;
    return this.deps.service.remove({
      projectId: input.projectId,
      versions: versions.filter((version) => thinned.has(version.id)),
    });
  }

  /** A dataset that is gone, or whose dataset or project was archived long enough ago. */
  async #isRetired(input: {
    projectId: string;
    datasetId: string;
    nowMs: number;
    projects: Map<string, Promise<number | null | undefined>>;
  }): Promise<boolean> {
    if (!input.projects.has(input.projectId)) {
      input.projects.set(input.projectId, this.deps.projectArchivedAt(input.projectId));
    }
    const projectArchivedAt = await input.projects.get(input.projectId);
    if (projectArchivedAt === undefined) return true;
    if (projectArchivedAt !== null && this.#keptLongEnough(projectArchivedAt, input.nowMs)) {
      return true;
    }
    const dataset = await this.deps.datasets.findById({
      id: input.datasetId,
      projectId: input.projectId,
      includeArchived: true,
    });
    if (!dataset) return true;
    if (!dataset.archivedAt) return false;
    return this.#keptLongEnough(dataset.archivedAt.getTime(), input.nowMs);
  }

  #keptLongEnough(archivedAtMs: number, nowMs: number): boolean {
    return nowMs - archivedAtMs >= DATASET_VERSION_ARCHIVED_KEEP_MS;
  }
}

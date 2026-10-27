/**
 * The retention sweep over every dataset's history: the last day whole, then one
 * version a day for 30 days, then one a week. Named, pinned and run-read versions stay.
 * Spec: modules/dataset/specs/dataset-versioning.feature.
 */
import { createLogger } from "@langwatch/observability";

import type { DatasetVersionRepository } from "../repositories/dataset-version.repository.ts";
import { DATASET_VERSION_KEEP_ALL_MS, versionsToThin } from "../rules/dataset-version.rules.ts";
import type { DatasetVersionService } from "./dataset-version.service.ts";

const logger = createLogger("langwatch:dataset:version-retention");

const DATASET_PAGE_SIZE = 100;

export type DatasetVersionRetentionSummary = { datasets: number; thinned: number };

export class DatasetVersionRetentionService {
  private constructor(
    private readonly deps: { versions: DatasetVersionRepository; service: DatasetVersionService },
  ) {}

  static create(deps: {
    versions: DatasetVersionRepository;
    service: DatasetVersionService;
  }): DatasetVersionRetentionService {
    return new DatasetVersionRetentionService(deps);
  }

  async sweep({ nowMs }: { nowMs: number }): Promise<DatasetVersionRetentionSummary> {
    const summary: DatasetVersionRetentionSummary = { datasets: 0, thinned: 0 };
    let afterDatasetId: string | null = null;
    let more = true;
    while (more) {
      const page = await this.deps.versions.findDatasetsWithHistory({
        afterDatasetId,
        olderThanMs: nowMs - DATASET_VERSION_KEEP_ALL_MS,
        limit: DATASET_PAGE_SIZE,
      });
      for (const { projectId, datasetId } of page) {
        summary.datasets += 1;
        summary.thinned += await this.thinDataset({ projectId, datasetId, nowMs });
      }
      more = page.length === DATASET_PAGE_SIZE;
      afterDatasetId = page.at(-1)?.datasetId ?? null;
    }
    if (summary.thinned > 0) logger.info(summary, "Thinned dataset version history");
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
}

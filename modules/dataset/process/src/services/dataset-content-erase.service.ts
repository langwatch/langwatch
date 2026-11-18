/**
 * Erasure of what a project's datasets keep in object storage. Postgres rows are what point at
 * these objects, so this runs before an erasure deletes them; every removal is idempotent.
 */
import type { DatasetChunkRepository } from "../repositories/dataset-chunk.repository.ts";
import type { DatasetSingleFileRepository } from "../repositories/dataset-single-file.repository.ts";
import type { DatasetVersionContentRepository } from "../repositories/dataset-version-content.repository.ts";
import type { DatasetVersionRepository } from "../repositories/dataset-version.repository.ts";
import type { DatasetRepository } from "../repositories/dataset.repository.ts";

const PAGE_SIZE = 100;

type DatasetContentEraseServiceOptions = {
  datasets: DatasetRepository;
  chunks: DatasetChunkRepository;
  versions: DatasetVersionRepository;
  versionContent: DatasetVersionContentRepository;
  singleFiles: DatasetSingleFileRepository;
};

export class DatasetContentEraseService {
  static create(options: DatasetContentEraseServiceOptions): DatasetContentEraseService {
    return new DatasetContentEraseService(options);
  }

  private constructor(private readonly options: DatasetContentEraseServiceOptions) {}

  /** Every dataset of the projects, archived included; answers how many were erased. */
  async eraseStoredContent(input: {
    projectIds: readonly string[];
  }): Promise<{ datasets: number }> {
    let datasets = 0;
    for (const projectId of input.projectIds) {
      datasets += await this.eraseProject(projectId);
    }
    return { datasets };
  }

  private async eraseProject(projectId: string): Promise<number> {
    let erased = 0;
    let afterId: string | undefined;
    let pageLength = PAGE_SIZE;
    while (pageLength === PAGE_SIZE) {
      const page = await this.options.datasets.findStoragePage({
        projectId,
        limit: PAGE_SIZE,
        ...(afterId ? { afterId } : {}),
      });
      for (const entry of page) {
        await this.eraseDataset({ projectId, datasetId: entry.id });
        erased++;
      }
      pageLength = page.length;
      afterId = page.at(-1)?.id;
    }
    return erased;
  }

  /** Whatever the layout says, every kind is removed: a converted dataset may keep its old file. */
  private async eraseDataset(key: { projectId: string; datasetId: string }): Promise<void> {
    const { chunks, versions, versionContent, singleFiles, datasets } = this.options;
    for (const version of await versions.findAll(key)) {
      await versionContent.deleteChunks({
        ...key,
        versionId: version.id,
        chunkCount: version.chunkCount,
      });
    }
    await chunks.deleteChunksFrom({ ...key, fromIndex: 0 });
    await singleFiles.removeSingleFile(key);
    const dataset = await datasets.findById({
      id: key.datasetId,
      projectId: key.projectId,
      includeArchived: true,
    });
    if (dataset?.stagingKey) {
      await chunks.removeStagedUpload({ projectId: key.projectId, stagingKey: dataset.stagingKey });
    }
  }
}

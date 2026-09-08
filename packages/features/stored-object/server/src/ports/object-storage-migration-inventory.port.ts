/**
 * The three pages a storage migration walks. Not persistence this feature owns:
 * the project and dataset rows belong to the project and dataset features, so
 * the process that holds those clients implements this port and hands it over.
 */
import type { StoredObject } from "#rules/stored-object-row.rules";

export type MigrationProject = {
  id: string;
  /** A tenant-owned bucket is never included in a global provider migration. */
  privateS3: boolean;
};

export type MigrationDataset = {
  id: string;
  projectId: string;
  contentLayout: string;
  status: string;
  chunkCount: number | null;
};

export type MigrationPageRequest = {
  afterId?: string;
  limit: number;
};

export abstract class ObjectStorageMigrationInventoryPort {
  abstract listProjectsPage(request: MigrationPageRequest): Promise<MigrationProject[]>;

  /** Returns a stable id-ordered page of latest ReplacingMergeTree versions. */
  abstract listStoredObjectsPage(
    projectId: string,
    request: MigrationPageRequest,
  ): Promise<StoredObject[]>;

  /**
   * Includes archived datasets: they remain recoverable customer data.
   * Per-project, because the Prisma multitenancy middleware rejects any Dataset
   * query without a projectId.
   */
  abstract listDatasetsPage(
    projectId: string,
    request: MigrationPageRequest,
  ): Promise<MigrationDataset[]>;
}

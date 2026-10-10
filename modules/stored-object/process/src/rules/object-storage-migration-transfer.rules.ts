/**
 * The pure half of the S3 <-> Azure migration: paging an inventory and addressing an endpoint.
 */
import { chunkKey } from "@langwatch/dataset-contract";
import {
  mintAzureBlobStoredObjectUri,
  mintS3StoredObjectUri,
} from "@langwatch/stored-object-contract";

import type {
  MigrationDataset,
  MigrationPageRequest,
} from "#repositories/object-storage-migration-inventory.repository";
import type { StoredObjectBlobRepository } from "#repositories/stored-object-blob.repository";

import type {
  MigrationProvider,
  MigrationStorageEndpoint,
} from "../services/object-storage-migration.service.ts";

const INVENTORY_PAGE_SIZE = 250;

export async function* paginate<T extends { id: string }>(
  load: (request: MigrationPageRequest) => Promise<T[]>,
): AsyncGenerator<T> {
  let afterId: string | undefined;
  let page: T[];
  do {
    page = await load({ afterId, limit: INVENTORY_PAGE_SIZE });
    if (page.length === 0) {
      return;
    }

    for (const row of page) {
      yield row;
    }

    const nextAfterId = page.at(-1)?.id;
    if (!nextAfterId || nextAfterId === afterId) {
      throw new Error("Migration inventory pagination did not advance");
    }

    afterId = nextAfterId;
  } while (page.length >= INVENTORY_PAGE_SIZE);
}

export function hasMigratableChunkCount(
  dataset: MigrationDataset,
): dataset is MigrationDataset & { chunkCount: number } {
  return dataset.chunkCount != null && dataset.chunkCount >= 0;
}

/** The addresses one provider's objects live at, bound to the driver that reads and writes them. */
export function createMigrationStorageEndpoint({
  provider,
  driver,
  bucket,
  accountName,
  container,
}: {
  provider: MigrationProvider;
  driver: StoredObjectBlobRepository;
  bucket?: string;
  accountName?: string;
  container?: string;
}): MigrationStorageEndpoint {
  if (provider === "s3") {
    if (!bucket?.trim()) {
      throw new Error("S3 migration endpoint requires a bucket");
    }

    return {
      provider,
      scheme: "s3",
      driver,
      storedObjectUri: (projectId, sha256Hex) =>
        mintS3StoredObjectUri({ bucket, projectId, sha256: sha256Hex }),
      datasetChunkUri: (projectId, datasetId, index) =>
        `s3://${bucket}/${chunkKey(projectId, datasetId, index)}`,
    };
  }

  if (!accountName?.trim() || !container?.trim()) {
    throw new Error("Azure migration endpoint requires an account name and container");
  }

  return {
    provider,
    scheme: "azure-blob",
    driver,
    storedObjectUri: (projectId, sha256Hex) =>
      mintAzureBlobStoredObjectUri({ accountName, container, projectId, sha256: sha256Hex }),
    datasetChunkUri: (projectId, datasetId, index) =>
      `azure-blob://${accountName}/${container}/${chunkKey(projectId, datasetId, index)}`,
  };
}

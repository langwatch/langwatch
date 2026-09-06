/**
 * The byte-level half of the S3 <-> Azure migration: paging an inventory, and copying one
 * object across with both ends digested.
 */
import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import { chunkKey } from "@langwatch/dataset-contract";
import {
  mintAzureBlobStoredObjectUri,
  mintS3StoredObjectUri,
  redactStoredObjectStorageUri,
} from "@langwatch/stored-object-contract";
import type { StoredObjectStorageDriver } from "#adapters/stored-object-storage-registry.adapter";
import type {
  MigrationDataset,
  MigrationPageRequest,
  MigrationProvider,
  MigrationStorageEndpoint,
} from "../services/object-storage-migration.service.ts";

const INVENTORY_PAGE_SIZE = 250;

export async function* paginate<T extends { id: string }>(
  load: (request: MigrationPageRequest) => Promise<T[]>,
): AsyncGenerator<T> {
  let afterId: string | undefined;
  for (;;) {
    const page = await load({ afterId, limit: INVENTORY_PAGE_SIZE });
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
    if (page.length < INVENTORY_PAGE_SIZE) {
      return;
    }
  }
}

export function hasMigratableChunkCount(
  dataset: MigrationDataset,
): dataset is MigrationDataset & { chunkCount: number } {
  return dataset.chunkCount != null && dataset.chunkCount >= 0;
}

export async function copyVerified({
  source,
  sourceUri,
  destination,
  destinationUri,
  expectedSha256,
  mediaType,
}: {
  source: MigrationStorageEndpoint;
  sourceUri: string;
  destination: MigrationStorageEndpoint;
  destinationUri: string;
  expectedSha256?: string;
  mediaType: string;
}): Promise<"copied" | "repaired" | "skippedVerified"> {
  // The ONLY full copy held in memory: `StoredObjectStorageDriver.put` takes a Buffer,
  // so the source bytes must be resident to write them. Every digest below
  // hashes its stream chunk-by-chunk instead of buffering a second (or
  // third) copy alongside — peak residency is one object, not two or three.
  const sourceBytes = await readAll(await source.driver.get(sourceUri));
  const sourceSha256 = sha256(sourceBytes);
  if (expectedSha256 && sourceSha256 !== expectedSha256) {
    throw new Error(
      `Source object verification failed for ${redactStoredObjectStorageUri(sourceUri)}: expected ${expectedSha256}, got ${sourceSha256}`,
    );
  }

  if (await destination.driver.exists(destinationUri)) {
    const destinationSha256 = await sha256OfStream(await destination.driver.get(destinationUri));
    if (destinationSha256 === sourceSha256) {
      return "skippedVerified";
    }

    await destination.driver.put(destinationUri, sourceBytes, mediaType);
    await assertUriDigest(destination.driver, destinationUri, sourceSha256);

    return "repaired";
  }

  await destination.driver.put(destinationUri, sourceBytes, mediaType);
  await assertUriDigest(destination.driver, destinationUri, sourceSha256);

  return "copied";
}

export async function assertUriDigest(
  driver: StoredObjectStorageDriver,
  uri: string,
  expectedSha256: string,
): Promise<void> {
  if (!(await driver.exists(uri))) {
    throw new Error(`Destination object is missing: ${redactStoredObjectStorageUri(uri)}`);
  }

  const actual = await sha256OfStream(await driver.get(uri));
  if (actual !== expectedSha256) {
    throw new Error(
      `Destination object verification failed for ${redactStoredObjectStorageUri(uri)}: expected ${expectedSha256}, got ${actual}`,
    );
  }
}

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Digest a stream chunk-by-chunk — nothing is retained beyond the hash state. */
export async function sha256OfStream(stream: Readable): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
  }

  return hash.digest("hex");
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
  driver: StoredObjectStorageDriver;
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

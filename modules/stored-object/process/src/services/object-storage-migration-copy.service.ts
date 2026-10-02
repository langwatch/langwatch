import { createHash } from "node:crypto";
import type { Readable } from "node:stream";

import { redactStoredObjectStorageUri } from "@langwatch/stored-object-contract";

import type { StoredObjectBlobRepository } from "#repositories/stored-object-blob.repository";

/** Copies one object between storage endpoints and proves both ends by sha256 digest. */
export class ObjectStorageMigrationCopyService {
  static create(): ObjectStorageMigrationCopyService {
    return new ObjectStorageMigrationCopyService();
  }

  private constructor() {}

  async copyVerified({
    source,
    sourceUri,
    destination,
    destinationUri,
    expectedSha256,
    mediaType,
  }: {
    source: { driver: StoredObjectBlobRepository };
    sourceUri: string;
    destination: { driver: StoredObjectBlobRepository };
    destinationUri: string;
    expectedSha256?: string;
    mediaType: string;
  }): Promise<"copied" | "repaired" | "skippedVerified"> {
    // The ONLY full copy held in memory: `StoredObjectBlobRepository.put` takes a Buffer,
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
      const destinationSha256 = await this.sha256OfStream(
        await destination.driver.get(destinationUri),
      );
      if (destinationSha256 === sourceSha256) {
        return "skippedVerified";
      }

      await destination.driver.put(destinationUri, sourceBytes, mediaType);
      await this.assertUriDigest(destination.driver, destinationUri, sourceSha256);

      return "repaired";
    }

    await destination.driver.put(destinationUri, sourceBytes, mediaType);
    await this.assertUriDigest(destination.driver, destinationUri, sourceSha256);

    return "copied";
  }

  async assertUriDigest(
    driver: StoredObjectBlobRepository,
    uri: string,
    expectedSha256: string,
  ): Promise<void> {
    if (!(await driver.exists(uri))) {
      throw new Error(`Destination object is missing: ${redactStoredObjectStorageUri(uri)}`);
    }

    const actual = await this.sha256OfStream(await driver.get(uri));
    if (actual !== expectedSha256) {
      throw new Error(
        `Destination object verification failed for ${redactStoredObjectStorageUri(uri)}: expected ${expectedSha256}, got ${actual}`,
      );
    }
  }

  /** Digest a stream chunk-by-chunk — nothing is retained beyond the hash state. */
  async sha256OfStream(stream: Readable): Promise<string> {
    const hash = createHash("sha256");
    for await (const chunk of stream) {
      hash.update(chunk);
    }

    return hash.digest("hex");
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

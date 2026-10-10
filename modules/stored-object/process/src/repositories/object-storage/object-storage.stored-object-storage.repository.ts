/**
 * The legacy ClickHouse index's byte reads, over the process's `objectStorage`
 * member. A legacy URI's object path is `{projectId}/{sha256}`, and that path is
 * the member key (ADR-158 §1: existing objects keep their keys).
 */
import { Readable } from "node:stream";

import type { ObjectStorage, StoredObjectAddress } from "@langwatch/process-stores/members";
import { getStoredObjectStorageScheme } from "@langwatch/stored-object-contract";

import { StoredObjectStorageRepository } from "../stored-object-storage.repository.ts";

export class ObjectStorageStoredObjectStorageRepository extends StoredObjectStorageRepository {
  static create(input: {
    objectStorage: ObjectStorage;
    projectId: string;
  }): ObjectStorageStoredObjectStorageRepository {
    return new ObjectStorageStoredObjectStorageRepository(input.objectStorage, input.projectId);
  }

  private constructor(
    private readonly objects: ObjectStorage,
    private readonly projectId: string,
  ) {
    super();
  }

  get = async (uri: string): Promise<Readable> =>
    Readable.from(await this.objects.read(this.addressOf(uri)), { objectMode: false });

  put = async (uri: string, bytes: Buffer, mediaType: string): Promise<void> => {
    await this.objects.write(this.addressOf(uri), bodyOf(bytes), {
      byteLength: bytes.byteLength,
      contentType: mediaType,
    });
  };

  delete = (uri: string): Promise<void> => this.objects.remove(this.addressOf(uri));

  exists = async (uri: string): Promise<boolean> => {
    try {
      const body = await this.objects.read(this.addressOf(uri));
      await body[Symbol.asyncIterator]().return?.();
      return true;
    } catch (error) {
      if (error instanceof Error && error.name === "StoredObjectNotFoundError") return false;
      throw error;
    }
  };

  private addressOf(uri: string): StoredObjectAddress {
    getStoredObjectStorageScheme(uri);
    const marker = `/${this.projectId}/`;
    const at = uri.indexOf(marker);
    if (at === -1) {
      throw new Error("A stored object's URI does not name a key under its own project.");
    }
    return { projectId: this.projectId, key: uri.slice(at + 1) };
  }
}

async function* bodyOf(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  yield bytes;
}

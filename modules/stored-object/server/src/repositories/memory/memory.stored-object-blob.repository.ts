/**
 * The same four byte operations as the S3, Azure Blob and filesystem tiers,
 * over one Map of storage URI to bytes. A read of a URI nothing was written
 * to rejects, the way an absent object does at every provider.
 */
import { Readable } from "node:stream";
import { ObjectNotFoundError } from "@langwatch/stored-object-contract";
import type { StoredObjectStorageDriver } from "../stored-object-blob.repository.ts";
import { MemoryStoredObjectBlobStore } from "./memory-stored-object-blob.store.ts";

export class MemoryStoredObjectBlobRepository implements StoredObjectStorageDriver {
  static create(
    store: MemoryStoredObjectBlobStore = MemoryStoredObjectBlobStore.create(),
  ): MemoryStoredObjectBlobRepository {
    return new MemoryStoredObjectBlobRepository(store);
  }

  readonly #store: MemoryStoredObjectBlobStore;

  private constructor(store: MemoryStoredObjectBlobStore) {
    this.#store = store;
  }

  async get(uri: string): Promise<Readable> {
    const entry = this.#store.find(uri);
    if (!entry) {
      throw new ObjectNotFoundError(uri);
    }
    return Readable.from([entry.bytes]);
  }

  async put(uri: string, bytes: Buffer, mediaType: string): Promise<void> {
    this.#store.put(uri, { bytes: Buffer.from(bytes), mediaType });
  }

  async delete(uri: string): Promise<void> {
    this.#store.delete(uri);
  }

  async exists(uri: string): Promise<boolean> {
    return this.#store.find(uri) !== null;
  }
}

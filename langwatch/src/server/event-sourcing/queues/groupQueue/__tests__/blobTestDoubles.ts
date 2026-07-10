import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";

import { ObjectNotFoundError } from "~/server/stored-objects/errors";

import type { JobBlobStore } from "../jobEnvelope";
import type { ObjectStore } from "../tieredBlobStore";

/** In-memory stand-in for the Redis blob tier (a {@link JobBlobStore}). */
export class InMemoryJobBlobStore implements JobBlobStore {
  readonly store = new Map<string, Buffer>();
  /** TTLs observed per call, so tests can pin which backstop each tier passes. */
  readonly putTtls: Array<number | undefined> = [];
  readonly getTtls: Array<number | undefined> = [];
  async put({
    id,
    data,
    ttlSeconds,
  }: {
    id: string;
    data: Buffer;
    ttlSeconds?: number;
  }): Promise<void> {
    this.putTtls.push(ttlSeconds);
    this.store.set(id, data);
  }
  async get({
    id,
    ttlSeconds,
  }: {
    id: string;
    ttlSeconds?: number;
  }): Promise<Buffer | null> {
    this.getTtls.push(ttlSeconds);
    return this.store.get(id) ?? null;
  }
  /** In-memory doubles have no TTL so peek and get behave identically. */
  async peek({ id }: { id: string }): Promise<Buffer | null> {
    return this.store.get(id) ?? null;
  }
  async delete({ id }: { id: string }): Promise<void> {
    this.store.delete(id);
  }
}

/**
 * In-memory stand-in for the stored-objects StorageRegistry (the GQ2 s3 tier).
 * A miss throws the registry's real {@link ObjectNotFoundError} — faithful to
 * what `S3Driver`/`LocalFilesystemDriver` actually throw, so a
 * missing-vs-transient classification gap between the double and production
 * can't hide behind the double. Deletes are recorded so out-of-band reclaim
 * can be asserted.
 */
export class InMemoryObjectStore implements ObjectStore {
  readonly store = new Map<string, Buffer>();
  readonly deleted: string[] = [];
  async put(uri: string, bytes: Buffer): Promise<void> {
    this.store.set(uri, bytes);
  }
  async get(uri: string): Promise<Readable> {
    const bytes = this.store.get(uri);
    if (!bytes) {
      throw new ObjectNotFoundError(uri);
    }
    return Readable.from(bytes);
  }
  async delete(uri: string): Promise<void> {
    this.deleted.push(uri);
    this.store.delete(uri);
  }
}

/** Serves objects, but fails the first N gets with a transient (non-missing) error. */
export class FlakyObjectStore extends InMemoryObjectStore {
  private getFailuresLeft: number;
  constructor(getFailures: number) {
    super();
    this.getFailuresLeft = getFailures;
  }
  async get(uri: string): Promise<Readable> {
    if (this.getFailuresLeft > 0) {
      this.getFailuresLeft--;
      throw new Error("transient ECONNRESET");
    }
    return super.get(uri);
  }
}

/**
 * Genuinely incompressible text (base64 of random bytes) so the gzipped body
 * stays above the s3 threshold — a compressible payload would collapse below it
 * and silently never exercise the s3 tier.
 */
export function incompressible(byteLength: number): string {
  return randomBytes(byteLength).toString("base64");
}

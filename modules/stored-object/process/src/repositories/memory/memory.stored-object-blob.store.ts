/**
 * The bytes the memory blob twins share. One store behind every twin built
 * from it, the way one bucket serves every client pointed at it: bytes put
 * through one repository are what another one reads back.
 */
export type StoredObjectBlobEntry = Readonly<{
  bytes: Buffer;
  mediaType: string;
}>;

export class MemoryStoredObjectBlobStore {
  static create(): MemoryStoredObjectBlobStore {
    return new MemoryStoredObjectBlobStore();
  }

  readonly #entries = new Map<string, StoredObjectBlobEntry>();

  private constructor() {}

  put(uri: string, entry: StoredObjectBlobEntry): void {
    this.#entries.set(uri, entry);
  }

  find(uri: string): StoredObjectBlobEntry | null {
    return this.#entries.get(uri) ?? null;
  }

  delete(uri: string): void {
    this.#entries.delete(uri);
  }

  get size(): number {
    return this.#entries.size;
  }
}

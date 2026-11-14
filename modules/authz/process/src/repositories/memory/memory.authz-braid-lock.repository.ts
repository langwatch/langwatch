import { AuthzBraidLockRepository } from "../authz-braid-lock.repository.ts";

/** One write per reader at a time inside this process: the memory twin of the advisory lock. */
export class MemoryAuthzBraidLockRepository extends AuthzBraidLockRepository {
  readonly #tails = new Map<string, Promise<unknown>>();

  static create(): MemoryAuthzBraidLockRepository {
    return new MemoryAuthzBraidLockRepository();
  }

  async withReaderLock<T>({
    readerProjectId,
    write,
  }: {
    readerProjectId: string;
    write: () => Promise<T>;
  }): Promise<T> {
    const previous = this.#tails.get(readerProjectId) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(write);
    this.#tails.set(readerProjectId, run);
    try {
      return await run;
    } finally {
      if (this.#tails.get(readerProjectId) === run) this.#tails.delete(readerProjectId);
    }
  }
}

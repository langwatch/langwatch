import { LwqlUnconfirmedSinceRepository } from "../langwatch-ql-unconfirmed-since.repository.ts";

/** One process's clock, for the memory tier and tests. */
export class MemoryLwqlUnconfirmedSinceRepository extends LwqlUnconfirmedSinceRepository {
  #since: number | undefined;

  static create(): MemoryLwqlUnconfirmedSinceRepository {
    return new MemoryLwqlUnconfirmedSinceRepository();
  }

  mark(at: number): Promise<number> {
    this.#since ??= at;
    return Promise.resolve(this.#since);
  }

  clear(): Promise<void> {
    this.#since = undefined;
    return Promise.resolve();
  }
}

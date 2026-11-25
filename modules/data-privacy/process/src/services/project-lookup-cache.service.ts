import { nowInstant } from "@langwatch/time";

type Entry<T> = { value: T; expiresAt: number };

/**
 * One value per project, kept for `ttlMs`. Concurrent misses of one project share one read
 * (ADR-177); a failed read is not kept, so the next call reads again.
 */
export class ProjectLookupCacheService<T> {
  static create<T>(input: { ttlMs: number; now?: () => number }): ProjectLookupCacheService<T> {
    return new ProjectLookupCacheService<T>(
      input.ttlMs,
      input.now ?? (() => nowInstant().epochMilliseconds),
    );
  }

  readonly #entries = new Map<string, Entry<T>>();
  readonly #inFlight = new Map<string, Promise<T>>();

  private constructor(
    private readonly ttlMs: number,
    private readonly now: () => number,
  ) {}

  /** The project's cached value, or `read`'s answer, shared with every read already waiting. */
  get(projectId: string, read: () => Promise<T>): Promise<T> {
    const cached = this.#entries.get(projectId);
    if (cached && cached.expiresAt > this.now()) return Promise.resolve(cached.value);

    const pending = this.#inFlight.get(projectId);
    if (pending) return pending;
    const lookup = this.#readAndKeep(projectId, read).finally(() => {
      if (this.#inFlight.get(projectId) === lookup) this.#inFlight.delete(projectId);
    });
    this.#inFlight.set(projectId, lookup);
    return lookup;
  }

  clear(): void {
    this.#entries.clear();
    this.#inFlight.clear();
  }

  async #readAndKeep(projectId: string, read: () => Promise<T>): Promise<T> {
    this.#entries.delete(projectId);
    const value = await read();
    this.#entries.set(projectId, { value, expiresAt: this.now() + this.ttlMs });
    return value;
  }
}

import { nowInstant, type Instant } from "@langwatch/time";

import {
  API_KEY_ANSWER_TTL_MS,
  ApiKeyAnswerCacheRepository,
} from "../api-key-answer-cache.repository.ts";

const MAX_HELD = 10_000;

/** One process's answers, for a boot with no Redis and for every test; expiry follows `now`. */
export class MemoryApiKeyAnswerCacheRepository extends ApiKeyAnswerCacheRepository {
  readonly #entries = new Map<string, { value: string; until: number }>();

  private constructor(private readonly now: () => Instant) {
    super();
  }

  static create(options: { now?: () => Instant } = {}): MemoryApiKeyAnswerCacheRepository {
    return new MemoryApiKeyAnswerCacheRepository(options.now ?? nowInstant);
  }

  findValues({ key }: { key: string }): Promise<string[]> {
    const entry = this.#entries.get(key);
    if (entry && entry.until > this.now().epochMilliseconds) return Promise.resolve([entry.value]);

    this.#entries.delete(key);
    return Promise.resolve([]);
  }

  set({
    key,
    value,
    ttlMs,
    onlyIfAbsent = false,
  }: {
    key: string;
    value: string;
    ttlMs: number;
    onlyIfAbsent?: boolean;
  }): Promise<void> {
    const held = this.#entries.get(key);
    if (onlyIfAbsent && held && held.until > this.now().epochMilliseconds) return Promise.resolve();

    const expiresInMs = Math.max(1, Math.min(Math.floor(ttlMs), API_KEY_ANSWER_TTL_MS));
    this.#entries.delete(key);
    if (this.#entries.size >= MAX_HELD) {
      const oldest = this.#entries.keys().next().value;
      if (oldest !== void 0) this.#entries.delete(oldest);
    }
    this.#entries.set(key, { value, until: this.now().epochMilliseconds + expiresInMs });
    return Promise.resolve();
  }

  delete({ key }: { key: string }): Promise<void> {
    this.#entries.delete(key);
    return Promise.resolve();
  }
}

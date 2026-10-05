import { nowInstant } from "@langwatch/time";

import type { ShareCacheRepository } from "../share-cache.repository.ts";

const VIEW_WINDOW_MS = 30 * 60 * 1000;
const PAYLOAD_TTL_MS = 60 * 1000;

/** The Redis viewer cache's memory twin: the same windows, held in this process. */
export class MemoryShareCacheRepository implements ShareCacheRepository {
  static create(): MemoryShareCacheRepository {
    return new MemoryShareCacheRepository();
  }

  readonly #viewings = new Map<string, number>();
  readonly #payloads = new Map<string, { payload: string; expiresAt: number }>();

  private constructor() {}

  isNewViewing({ shareId, viewerKey }: { shareId: string; viewerKey: string }): Promise<boolean> {
    const key = `${shareId}:${viewerKey}`;
    const now = nowInstant().epochMilliseconds;
    const held = this.#viewings.get(key);
    if (held !== undefined && held > now) return Promise.resolve(false);
    this.#viewings.set(key, now + VIEW_WINDOW_MS);
    return Promise.resolve(true);
  }

  findPayload(key: string): Promise<unknown> {
    const entry = this.#payloads.get(key);
    if (!entry || entry.expiresAt <= nowInstant().epochMilliseconds) return Promise.resolve(null);
    return Promise.resolve(JSON.parse(entry.payload));
  }

  setPayload(key: string, payload: unknown): Promise<void> {
    this.#payloads.set(key, {
      payload: JSON.stringify(payload),
      expiresAt: nowInstant().epochMilliseconds + PAYLOAD_TTL_MS,
    });
    return Promise.resolve();
  }
}

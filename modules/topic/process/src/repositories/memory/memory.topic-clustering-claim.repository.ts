import { nowInstant } from "@langwatch/time";

import type { TopicClusteringClaimRepository } from "../topic-clustering-claim.repository.ts";

/** The memory twin: an expiring claim and a permanent marker per key, one process wide. */
export class MemoryTopicClusteringClaimRepository implements TopicClusteringClaimRepository {
  readonly #claims = new Map<string, number>();
  readonly #marks = new Map<string, string>();

  static create(): MemoryTopicClusteringClaimRepository {
    return new MemoryTopicClusteringClaimRepository();
  }

  private constructor() {}

  async claim(input: { key: string; ttlSeconds: number }): Promise<boolean> {
    const now = nowInstant().epochMilliseconds;
    const expiresAt = this.#claims.get(input.key);
    if (expiresAt !== undefined && expiresAt > now) return false;
    this.#claims.set(input.key, now + input.ttlSeconds * 1000);
    return true;
  }

  async release(input: { key: string }): Promise<void> {
    this.#claims.delete(input.key);
  }

  async mark(input: { key: string; value: string }): Promise<void> {
    this.#marks.set(input.key, input.value);
  }

  async isMarked(input: { key: string }): Promise<boolean> {
    return this.#marks.has(input.key);
  }
}

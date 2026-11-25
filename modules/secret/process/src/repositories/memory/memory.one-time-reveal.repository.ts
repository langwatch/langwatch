/**
 * The in-process twin of the Redis reveal store, with the same expiry and the
 * same read-and-delete: an instance running without Redis still completes the
 * flow, and a test exercises the shipped service rather than a stand-in.
 */
import { nowInstant } from "@langwatch/time";

import type {
  OneTimeRevealRepository,
  RevealAddress,
  StoredReveal,
  TakenReveal,
} from "../one-time-reveal.repository.ts";

type Expiring<T> = { value: T; expiresAtMs: number };

export class MemoryOneTimeRevealRepository implements OneTimeRevealRepository {
  readonly #reveals = new Map<string, Expiring<StoredReveal>>();
  readonly #markers = new Map<string, number>();
  readonly #nowMs: () => number;

  private constructor(nowMs: () => number) {
    this.#nowMs = nowMs;
  }

  static create(options: { nowMs?: () => number } = {}): MemoryOneTimeRevealRepository {
    return new MemoryOneTimeRevealRepository(
      options.nowMs ?? (() => nowInstant().epochMilliseconds),
    );
  }

  async put({
    reveal,
    ttlMs,
    ...address
  }: RevealAddress & { reveal: StoredReveal; ttlMs: number }): Promise<void> {
    this.#reveals.set(this.keyOf(address), {
      value: reveal,
      expiresAtMs: this.#nowMs() + ttlMs,
    });
  }

  async take(address: RevealAddress): Promise<TakenReveal> {
    const key = this.keyOf(address);
    const entry = this.#reveals.get(key);
    this.#reveals.delete(key);
    if (!entry || entry.expiresAtMs <= this.#nowMs()) return { taken: false };

    return { taken: true, reveal: entry.value };
  }

  async markServed({ ttlMs, ...address }: RevealAddress & { ttlMs: number }): Promise<void> {
    this.#markers.set(this.keyOf(address), this.#nowMs() + ttlMs);
  }

  async wasServed(address: RevealAddress): Promise<boolean> {
    const key = this.keyOf(address);
    const expiresAtMs = this.#markers.get(key);
    if (expiresAtMs === undefined) return false;
    if (expiresAtMs > this.#nowMs()) return true;
    this.#markers.delete(key);

    return false;
  }

  /** The organization and recipient are part of the key, so nobody else's id
   *  reads this reveal even where the ids collide. */
  private keyOf({ organizationId, recipientUserId, revealId }: RevealAddress): string {
    return `${organizationId}${recipientUserId}${revealId}`;
  }
}

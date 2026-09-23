/**
 * The in-process twin of the Redis reveal store, with the same expiry and the
 * same read-and-delete: an instance running without Redis still completes the
 * flow, and a test exercises the shipped service rather than a stand-in.
 */
import { nowInstant } from "@langwatch/time";

import type {
  OneTimeRevealRepository,
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
    organizationId,
    revealId,
    reveal,
    ttlMs,
  }: {
    organizationId: string;
    revealId: string;
    reveal: StoredReveal;
    ttlMs: number;
  }): Promise<void> {
    this.#reveals.set(this.keyOf(organizationId, revealId), {
      value: reveal,
      expiresAtMs: this.#nowMs() + ttlMs,
    });
  }

  async take({
    organizationId,
    revealId,
  }: {
    organizationId: string;
    revealId: string;
  }): Promise<TakenReveal> {
    const key = this.keyOf(organizationId, revealId);
    const entry = this.#reveals.get(key);
    this.#reveals.delete(key);
    if (!entry || entry.expiresAtMs <= this.#nowMs()) return { taken: false };

    return { taken: true, reveal: entry.value };
  }

  async markServed({
    organizationId,
    revealId,
    ttlMs,
  }: {
    organizationId: string;
    revealId: string;
    ttlMs: number;
  }): Promise<void> {
    this.#markers.set(this.keyOf(organizationId, revealId), this.#nowMs() + ttlMs);
  }

  async wasServed({
    organizationId,
    revealId,
  }: {
    organizationId: string;
    revealId: string;
  }): Promise<boolean> {
    const key = this.keyOf(organizationId, revealId);
    const expiresAtMs = this.#markers.get(key);
    if (expiresAtMs === undefined) return false;
    if (expiresAtMs > this.#nowMs()) return true;
    this.#markers.delete(key);

    return false;
  }

  /** The organization is part of the key, so one organization's id never
   *  reads another's reveal even where the ids collide. */
  private keyOf(organizationId: string, revealId: string): string {
    return `${organizationId}${revealId}`;
  }
}

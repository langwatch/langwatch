import { nowInstant } from "@langwatch/time";

import type { StoredUserWait } from "../../rules/langy-local-user-wait-record.rules.ts";
import type { LocalRecordLookup } from "../langy-local-call.repository.ts";
import { LangyLocalUserWaitRepository } from "../langy-local-user-wait.repository.ts";

type Expiring<T> = { value: T; expiresAt: number };

/**
 * The user waits for a process without Redis, in plain maps. Expiry is
 * checked on read, so a test drives the clock through `now`.
 */
export class LangyLocalUserWaitMemoryRepository extends LangyLocalUserWaitRepository {
  readonly #now: () => number;
  readonly #waits = new Map<string, Expiring<StoredUserWait>>();
  readonly #pending = new Map<string, Expiring<Map<string, number>>>();

  private constructor(now: () => number) {
    super();
    this.#now = now;
  }

  static create({
    now = () => nowInstant().epochMilliseconds,
  }: { now?: () => number } = {}): LangyLocalUserWaitMemoryRepository {
    return new LangyLocalUserWaitMemoryRepository(now);
  }

  async save({ wait, ttlSeconds }: { wait: StoredUserWait; ttlSeconds: number }): Promise<void> {
    this.#waits.set(wait.waitId, { value: wait, expiresAt: this.#expiry(ttlSeconds) });
  }

  async find(waitId: string): Promise<LocalRecordLookup<StoredUserWait>> {
    const wait = this.#live(this.#waits, waitId);
    return wait ? { kind: "hit", value: wait } : { kind: "miss" };
  }

  async trackPending({
    conversationId,
    turnId,
    waitId,
    expiresAt,
    ttlSeconds,
  }: {
    conversationId: string;
    turnId: string;
    waitId: string;
    expiresAt: number;
    ttlSeconds: number;
  }): Promise<void> {
    const key = turnOf({ conversationId, turnId });
    const set = this.#live(this.#pending, key) ?? new Map<string, number>();
    set.set(waitId, expiresAt);
    this.#pending.set(key, { value: set, expiresAt: this.#expiry(ttlSeconds) });
  }

  async untrackPending({
    conversationId,
    turnId,
    waitId,
  }: {
    conversationId: string;
    turnId: string;
    waitId: string;
  }): Promise<void> {
    this.#live(this.#pending, turnOf({ conversationId, turnId }))?.delete(waitId);
  }

  async findPendingIds({
    conversationId,
    turnId,
  }: {
    conversationId: string;
    turnId: string;
  }): Promise<string[]> {
    return [...(this.#live(this.#pending, turnOf({ conversationId, turnId })) ?? [])]
      .filter(([, score]) => score >= 0)
      .toSorted(([, left], [, right]) => left - right)
      .map(([waitId]) => waitId);
  }

  #expiry(ttlSeconds: number): number {
    return this.#now() + ttlSeconds * 1000;
  }

  #live<T>(map: Map<string, Expiring<T>>, key: string): T | null {
    const entry = map.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.#now()) {
      map.delete(key);
      return null;
    }
    return entry.value;
  }
}

function turnOf({ conversationId, turnId }: { conversationId: string; turnId: string }): string {
  return `${conversationId}:${turnId}`;
}

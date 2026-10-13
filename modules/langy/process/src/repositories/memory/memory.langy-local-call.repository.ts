import { nowInstant } from "@langwatch/time";

import type { StoredLocalCall } from "../../rules/langy-local-call-record.rules.ts";
import {
  LangyLocalCallRepository,
  type LocalRecordLookup,
} from "../langy-local-call.repository.ts";

type Expiring<T> = { value: T; expiresAt: number };

/**
 * The local calls for a process without Redis, in plain maps. Expiry is
 * checked on read, so a test drives the clock through `now`. Two runtimes
 * handed one instance play two pods.
 */
export class LangyLocalCallMemoryRepository extends LangyLocalCallRepository {
  readonly #now: () => number;
  readonly #calls = new Map<string, Expiring<StoredLocalCall>>();
  readonly #pending = new Map<string, Expiring<Map<string, number>>>();
  readonly #keepalives = new Map<string, Expiring<number>>();

  private constructor(now: () => number) {
    super();
    this.#now = now;
  }

  static create({
    now = () => nowInstant().epochMilliseconds,
  }: { now?: () => number } = {}): LangyLocalCallMemoryRepository {
    return new LangyLocalCallMemoryRepository(now);
  }

  async save({ call, ttlSeconds }: { call: StoredLocalCall; ttlSeconds: number }): Promise<void> {
    this.#calls.set(call.callId, { value: call, expiresAt: this.#expiry(ttlSeconds) });
  }

  async find(callId: string): Promise<LocalRecordLookup<StoredLocalCall>> {
    const call = this.#live(this.#calls, callId);
    return call ? { kind: "hit", value: call } : { kind: "miss" };
  }

  async trackPending({
    conversationId,
    callId,
    expiresAt,
    ttlSeconds,
  }: {
    conversationId: string;
    callId: string;
    expiresAt: number;
    ttlSeconds: number;
  }): Promise<void> {
    const set = this.#live(this.#pending, conversationId) ?? new Map<string, number>();
    set.set(callId, expiresAt);
    this.#pending.set(conversationId, { value: set, expiresAt: this.#expiry(ttlSeconds) });
  }

  async untrackPending({
    conversationId,
    callId,
  }: {
    conversationId: string;
    callId: string;
  }): Promise<void> {
    this.#live(this.#pending, conversationId)?.delete(callId);
  }

  async dropLapsedPending({
    conversationId,
    lapsedAt,
  }: {
    conversationId: string;
    lapsedAt: number;
  }): Promise<void> {
    const set = this.#live(this.#pending, conversationId);
    for (const [callId, score] of set ?? []) {
      if (score <= lapsedAt) set?.delete(callId);
    }
  }

  async findPendingIds({
    conversationId,
    from,
  }: {
    conversationId: string;
    from: number;
  }): Promise<string[]> {
    return [...(this.#live(this.#pending, conversationId) ?? [])]
      .filter(([, score]) => score >= from)
      .toSorted(([, left], [, right]) => left - right)
      .map(([callId]) => callId);
  }

  async claimKeepaliveWindow({
    callId,
    at,
    ttlSeconds,
  }: {
    callId: string;
    at: number;
    ttlSeconds: number;
  }): Promise<boolean> {
    if (this.#live(this.#keepalives, callId) !== null) return false;
    this.#keepalives.set(callId, { value: at, expiresAt: this.#expiry(ttlSeconds) });
    return true;
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

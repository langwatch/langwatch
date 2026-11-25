import { nowInstant } from "@langwatch/time";

import type { LocalRecordLookup } from "../langy-local-call.repository.ts";
import {
  LangyLocalControlRequestRepository,
  type SessionKeyBinding,
  type StoredControlRequest,
} from "../langy-local-control-request.repository.ts";

type Expiring<T> = { value: T; expiresAt: number };

/** Members by score, as a scored set keeps them. */
type ScoredSet = Map<string, number>;

/**
 * The control requests and key bindings for a process without Redis, in
 * plain maps. Expiry is checked on read, so a test drives the clock through
 * `now`.
 */
export class LangyLocalControlRequestMemoryRepository extends LangyLocalControlRequestRepository {
  readonly #now: () => number;
  readonly #requests = new Map<string, Expiring<StoredControlRequest>>();
  readonly #userRequests = new Map<string, Expiring<ScoredSet>>();
  readonly #claims = new Map<string, Expiring<string>>();
  readonly #bindings = new Map<string, Expiring<SessionKeyBinding>>();
  readonly #conversationKeys = new Map<string, Expiring<ScoredSet>>();

  private constructor(now: () => number) {
    super();
    this.#now = now;
  }

  static create({
    now = () => nowInstant().epochMilliseconds,
  }: { now?: () => number } = {}): LangyLocalControlRequestMemoryRepository {
    return new LangyLocalControlRequestMemoryRepository(now);
  }

  async saveRequest({
    request,
    ttlSeconds,
  }: {
    request: StoredControlRequest;
    ttlSeconds: number;
  }): Promise<void> {
    this.#requests.set(request.id, { value: request, expiresAt: this.#expiry(ttlSeconds) });
  }

  async indexOpenRequest({
    userId,
    requestId,
    expiresAt,
    ttlSeconds,
  }: {
    userId: string;
    requestId: string;
    expiresAt: number;
    ttlSeconds: number;
  }): Promise<void> {
    this.#add({
      map: this.#userRequests,
      key: userId,
      member: requestId,
      score: expiresAt,
      ttlSeconds,
    });
  }

  async dropLapsedRequests({
    userId,
    lapsedAt,
  }: {
    userId: string;
    lapsedAt: number;
  }): Promise<void> {
    const set = this.#live(this.#userRequests, userId);
    for (const [requestId, score] of set ?? []) {
      if (score <= lapsedAt) set?.delete(requestId);
    }
  }

  async findOpenRequestIds({ userId, from }: { userId: string; from: number }): Promise<string[]> {
    return this.#range({ map: this.#userRequests, key: userId, from });
  }

  async findRequest(requestId: string): Promise<LocalRecordLookup<StoredControlRequest>> {
    const request = this.#live(this.#requests, requestId);
    return request ? { kind: "hit", value: request } : { kind: "miss" };
  }

  async forgetRequest({ requestId, userId }: { requestId: string; userId: string }): Promise<void> {
    this.#requests.delete(requestId);
    this.#live(this.#userRequests, userId)?.delete(requestId);
  }

  async claimRequest({
    requestId,
    userId,
    ttlSeconds,
  }: {
    requestId: string;
    userId: string;
    ttlSeconds: number;
  }): Promise<boolean> {
    if (this.#live(this.#claims, requestId) !== null) return false;
    this.#claims.set(requestId, { value: userId, expiresAt: this.#expiry(ttlSeconds) });
    return true;
  }

  async isClaimed(requestId: string): Promise<boolean> {
    return this.#live(this.#claims, requestId) !== null;
  }

  async saveKeyBinding({
    apiKeyId,
    binding,
    ttlSeconds,
  }: {
    apiKeyId: string;
    binding: SessionKeyBinding;
    ttlSeconds: number;
  }): Promise<void> {
    this.#bindings.set(apiKeyId, { value: binding, expiresAt: this.#expiry(ttlSeconds) });
  }

  async indexKeyBinding({
    conversationId,
    apiKeyId,
    lapsesAt,
    ttlSeconds,
  }: {
    conversationId: string;
    apiKeyId: string;
    lapsesAt: number;
    ttlSeconds: number;
  }): Promise<void> {
    this.#add({
      map: this.#conversationKeys,
      key: conversationId,
      member: apiKeyId,
      score: lapsesAt,
      ttlSeconds,
    });
  }

  async findKeyBinding(apiKeyId: string): Promise<LocalRecordLookup<SessionKeyBinding>> {
    const binding = this.#live(this.#bindings, apiKeyId);
    return binding ? { kind: "hit", value: binding } : { kind: "miss" };
  }

  async deleteKeyBinding(apiKeyId: string): Promise<void> {
    this.#bindings.delete(apiKeyId);
  }

  async unindexKeyBinding({
    conversationId,
    apiKeyId,
  }: {
    conversationId: string;
    apiKeyId: string;
  }): Promise<void> {
    this.#live(this.#conversationKeys, conversationId)?.delete(apiKeyId);
  }

  async findKeyBindingIds(conversationId: string): Promise<string[]> {
    return this.#range({ map: this.#conversationKeys, key: conversationId, from: 0 });
  }

  #add({
    map,
    key,
    member,
    score,
    ttlSeconds,
  }: {
    map: Map<string, Expiring<ScoredSet>>;
    key: string;
    member: string;
    score: number;
    ttlSeconds: number;
  }): void {
    const set = this.#live(map, key) ?? new Map<string, number>();
    set.set(member, score);
    map.set(key, { value: set, expiresAt: this.#expiry(ttlSeconds) });
  }

  #range({
    map,
    key,
    from,
  }: {
    map: Map<string, Expiring<ScoredSet>>;
    key: string;
    from: number;
  }): string[] {
    return [...(this.#live(map, key) ?? [])]
      .filter(([, score]) => score >= from)
      .toSorted(([, left], [, right]) => left - right)
      .map(([member]) => member);
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

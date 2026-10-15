import type { StoredCall, StoredResult } from "@langwatch/agent-contract";
import { nowInstant } from "@langwatch/time";

import {
  ConnectedAgentStateRepository,
  type InstanceRecord,
  type StoredLookup,
  type StoredSession,
  type ThreadPinLookup,
} from "../connected-agent-state.repository.ts";

type Expiring<T> = { value: T; expiresAt: number };

/** Members by score, as a scored set keeps them. */
type ScoredSet = Map<string, number>;

/**
 * The relay's state for a process without Redis, in plain maps. Expiry is
 * checked on read, so a test drives the clock through `now` and never waits
 * on a timer. Two runtimes handed one instance play two pods.
 */
export class MemoryConnectedAgentStateRepository extends ConnectedAgentStateRepository {
  readonly #now: () => number;
  readonly #instances = new Map<string, Expiring<InstanceRecord>>();
  readonly #seen = new Map<string, Expiring<ScoredSet>>();
  readonly #inflight = new Map<string, Expiring<number>>();
  readonly #owners = new Map<string, Expiring<string>>();
  readonly #calls = new Map<string, Expiring<StoredCall>>();
  readonly #acks = new Map<string, Expiring<true>>();
  readonly #deliveries = new Map<string, Expiring<true>>();
  readonly #pending = new Map<string, Expiring<ScoredSet>>();
  readonly #results = new Map<string, Expiring<StoredResult>>();
  readonly #sessions = new Map<string, Expiring<StoredSession>>();
  readonly #pins = new Map<string, Expiring<string>>();

  private constructor(now: () => number) {
    super();
    this.#now = now;
  }

  static create({
    now = () => nowInstant().epochMilliseconds,
  }: { now?: () => number } = {}): MemoryConnectedAgentStateRepository {
    return new MemoryConnectedAgentStateRepository(now);
  }

  async saveInstance({
    meta,
    agentIds,
    ttlSeconds,
  }: InstanceRecord & { ttlSeconds: number }): Promise<void> {
    this.#put({
      map: this.#instances,
      key: keyOf(meta.projectId, meta.instanceId),
      value: { meta, agentIds },
      ttlSeconds,
    });
  }

  async extendInstance({
    projectId,
    instanceId,
    restore,
    ttlSeconds,
  }: {
    projectId: string;
    instanceId: string;
    restore?: InstanceRecord;
    ttlSeconds: number;
  }): Promise<void> {
    const key = keyOf(projectId, instanceId);
    const record = this.#live(this.#instances, key) ?? restore;
    if (record) this.#put({ map: this.#instances, key, value: record, ttlSeconds });
  }

  async findInstance({
    projectId,
    instanceId,
  }: {
    projectId: string;
    instanceId: string;
  }): Promise<InstanceRecord[]> {
    const record = this.#live(this.#instances, keyOf(projectId, instanceId));
    return record ? [record] : [];
  }

  async deleteInstance({
    projectId,
    instanceId,
  }: {
    projectId: string;
    instanceId: string;
  }): Promise<void> {
    this.#instances.delete(keyOf(projectId, instanceId));
  }

  async markInstanceSeen({
    projectId,
    agentId,
    instanceId,
    seenAt,
    ttlSeconds,
  }: {
    projectId: string;
    agentId: string;
    instanceId: string;
    seenAt: number;
    ttlSeconds: number;
  }): Promise<void> {
    this.#scoredSet(this.#seen, keyOf(projectId, agentId), ttlSeconds).set(instanceId, seenAt);
  }

  async lowerInstanceSeen({
    projectId,
    agentId,
    instanceId,
    seenAt,
  }: {
    projectId: string;
    agentId: string;
    instanceId: string;
    seenAt: number;
  }): Promise<void> {
    const set = this.#live(this.#seen, keyOf(projectId, agentId));
    const current = set?.get(instanceId);
    if (set && current !== undefined && seenAt < current) set.set(instanceId, seenAt);
  }

  async pruneSeenInstanceIds({
    projectId,
    agentId,
    cutoff,
  }: {
    projectId: string;
    agentId: string;
    cutoff: number;
  }): Promise<string[]> {
    const set = this.#live(this.#seen, keyOf(projectId, agentId));
    if (!set) return [];
    for (const [member, score] of set) {
      if (score <= cutoff) set.delete(member);
    }
    return membersScoredAtLeast(set, cutoff);
  }

  async countInflight({
    projectId,
    instanceId,
  }: {
    projectId: string;
    instanceId: string;
  }): Promise<number> {
    return this.#live(this.#inflight, keyOf(projectId, instanceId)) ?? 0;
  }

  async incrementInflight({
    projectId,
    instanceId,
    ttlSeconds,
  }: {
    projectId: string;
    instanceId: string;
    ttlSeconds: number;
  }): Promise<number> {
    const key = keyOf(projectId, instanceId);
    const next = (this.#live(this.#inflight, key) ?? 0) + 1;
    this.#put({ map: this.#inflight, key, value: next, ttlSeconds });
    return next;
  }

  async decrementInflight({
    projectId,
    instanceId,
  }: {
    projectId: string;
    instanceId: string;
  }): Promise<number> {
    const key = keyOf(projectId, instanceId);
    const entry = this.#inflight.get(key);
    if (!entry) return 0;
    const next = Math.max(0, entry.value - 1);
    if (next === 0) this.#inflight.delete(key);
    else this.#inflight.set(key, { ...entry, value: next });
    return next;
  }

  async claimInstanceOwner({
    projectId,
    instanceId,
    principalId,
    ttlSeconds,
  }: {
    projectId: string;
    instanceId: string;
    principalId: string;
    ttlSeconds: number;
  }): Promise<boolean> {
    const key = keyOf(projectId, instanceId);
    const current = this.#live(this.#owners, key);
    if (current !== null && current !== principalId) return false;
    this.#put({ map: this.#owners, key, value: principalId, ttlSeconds });
    return true;
  }

  async saveCall({ call, ttlSeconds }: { call: StoredCall; ttlSeconds: number }): Promise<void> {
    this.#put({
      map: this.#calls,
      key: keyOf(call.projectId, call.envelope.callId),
      value: call,
      ttlSeconds,
    });
  }

  async readCall({
    projectId,
    callId,
  }: {
    projectId: string;
    callId: string;
  }): Promise<StoredLookup<StoredCall>> {
    return lookupOf(this.#live(this.#calls, keyOf(projectId, callId)));
  }

  async deleteCall({ projectId, callId }: { projectId: string; callId: string }): Promise<void> {
    this.#calls.delete(keyOf(projectId, callId));
  }

  async markCallAcked({
    projectId,
    callId,
    ttlSeconds,
  }: {
    projectId: string;
    callId: string;
    ttlSeconds: number;
  }): Promise<void> {
    this.#put({ map: this.#acks, key: keyOf(projectId, callId), value: true, ttlSeconds });
  }

  async claimCallDelivery({
    projectId,
    callId,
    ttlSeconds,
  }: {
    projectId: string;
    callId: string;
    ttlSeconds: number;
  }): Promise<boolean> {
    const key = keyOf(projectId, callId);
    if (this.#live(this.#deliveries, key) !== null) return false;
    this.#put({ map: this.#deliveries, key, value: true, ttlSeconds });
    return true;
  }

  async addPendingCall({
    projectId,
    instanceId,
    callId,
    deadlineAt,
    ttlSeconds,
  }: {
    projectId: string;
    instanceId: string;
    callId: string;
    deadlineAt: number;
    ttlSeconds: number;
  }): Promise<void> {
    this.#scoredSet(this.#pending, keyOf(projectId, instanceId), ttlSeconds).set(
      callId,
      deadlineAt,
    );
  }

  async removePendingCall({
    projectId,
    instanceId,
    callId,
  }: {
    projectId: string;
    instanceId: string;
    callId: string;
  }): Promise<void> {
    this.#live(this.#pending, keyOf(projectId, instanceId))?.delete(callId);
  }

  async findPendingCallIds({
    projectId,
    instanceId,
    from,
  }: {
    projectId: string;
    instanceId: string;
    from: number;
  }): Promise<string[]> {
    const set = this.#live(this.#pending, keyOf(projectId, instanceId));
    return set ? membersScoredAtLeast(set, from) : [];
  }

  async saveResult({
    projectId,
    callId,
    result,
    ttlSeconds,
  }: {
    projectId: string;
    callId: string;
    result: StoredResult;
    ttlSeconds: number;
  }): Promise<void> {
    this.#put({ map: this.#results, key: keyOf(projectId, callId), value: result, ttlSeconds });
  }

  async readResult({
    projectId,
    callId,
  }: {
    projectId: string;
    callId: string;
  }): Promise<StoredLookup<StoredResult>> {
    return lookupOf(this.#live(this.#results, keyOf(projectId, callId)));
  }

  async saveHttpSession({
    session,
    ttlSeconds,
  }: {
    session: StoredSession;
    ttlSeconds: number;
  }): Promise<void> {
    this.#put({
      map: this.#sessions,
      key: keyOf(session.projectId, session.token),
      value: session,
      ttlSeconds,
    });
  }

  async readHttpSession({
    projectId,
    token,
  }: {
    projectId: string;
    token: string;
  }): Promise<StoredLookup<StoredSession>> {
    return lookupOf(this.#live(this.#sessions, keyOf(projectId, token)));
  }

  async deleteHttpSession({
    projectId,
    token,
  }: {
    projectId: string;
    token: string;
  }): Promise<void> {
    this.#sessions.delete(keyOf(projectId, token));
  }

  async pinThread({
    projectId,
    agentId,
    threadId,
    instanceId,
    ttlSeconds,
  }: {
    projectId: string;
    agentId: string;
    threadId: string;
    instanceId: string;
    ttlSeconds: number;
  }): Promise<void> {
    this.#put({
      map: this.#pins,
      key: keyOf(projectId, agentId, threadId),
      value: instanceId,
      ttlSeconds,
    });
  }

  async readThreadPin({
    projectId,
    agentId,
    threadId,
  }: {
    projectId: string;
    agentId: string;
    threadId: string;
  }): Promise<ThreadPinLookup> {
    const instanceId = this.#live(this.#pins, keyOf(projectId, agentId, threadId));
    return instanceId ? { kind: "pinned", instanceId } : { kind: "unpinned" };
  }

  /** The value under a key, or nothing once its expiry passed. */
  #live<T>(map: Map<string, Expiring<T>>, key: string): T | null {
    const entry = map.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.#now()) {
      map.delete(key);
      return null;
    }
    return entry.value;
  }

  #put<T>({
    map,
    key,
    value,
    ttlSeconds,
  }: {
    map: Map<string, Expiring<T>>;
    key: string;
    value: T;
    ttlSeconds: number;
  }): void {
    map.set(key, { value, expiresAt: this.#now() + ttlSeconds * 1000 });
  }

  /** The scored set under a key, created when absent; every add renews its expiry. */
  #scoredSet(map: Map<string, Expiring<ScoredSet>>, key: string, ttlSeconds: number): ScoredSet {
    const set = this.#live(map, key) ?? new Map<string, number>();
    this.#put({ map, key, value: set, ttlSeconds });
    return set;
  }
}

function keyOf(...parts: string[]): string {
  return parts.join("\u0000");
}

/** Members scored at or above `min`, lowest score first. */
function membersScoredAtLeast(set: ScoredSet, min: number): string[] {
  return [...set]
    .filter(([, score]) => score >= min)
    .toSorted(([, left], [, right]) => left - right)
    .map(([member]) => member);
}

function lookupOf<T>(value: T | null): StoredLookup<T> {
  return value === null ? { kind: "miss" } : { kind: "hit", value };
}

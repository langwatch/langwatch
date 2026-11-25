import type { SessionStateStore } from "@langwatch/redis-client/session-state";

import {
  storedLocalCallSchema,
  type StoredLocalCall,
} from "../../rules/langy-local-call-record.rules.ts";
import {
  callKeepaliveKey,
  callKey,
  pendingCallsKey,
} from "../../rules/langy-local-control-keys.rules.ts";
import {
  LangyLocalCallRepository,
  type LocalRecordLookup,
} from "../langy-local-call.repository.ts";

/** The local calls in the process's Redis, under the local-control key family. */
export class LangyLocalCallRedisRepository extends LangyLocalCallRepository {
  private readonly store: SessionStateStore;

  private constructor({ store }: { store: SessionStateStore }) {
    super();
    this.store = store;
  }

  static create({ store }: { store: SessionStateStore }): LangyLocalCallRedisRepository {
    return new LangyLocalCallRedisRepository({ store });
  }

  async save({ call, ttlSeconds }: { call: StoredLocalCall; ttlSeconds: number }): Promise<void> {
    await this.store.set(callKey(call.callId), JSON.stringify(call), ttlSeconds);
  }

  async find(callId: string): Promise<LocalRecordLookup<StoredLocalCall>> {
    const raw = await this.store.tryGet(callKey(callId));
    if (!raw) return { kind: "miss" };
    try {
      return { kind: "hit", value: storedLocalCallSchema.parse(JSON.parse(raw)) };
    } catch (error) {
      return { kind: "unreadable", reasons: error instanceof Error ? [error] : [] };
    }
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
    await this.store.zadd({
      key: pendingCallsKey(conversationId),
      score: expiresAt,
      member: callId,
      ttlSeconds,
    });
  }

  async untrackPending({
    conversationId,
    callId,
  }: {
    conversationId: string;
    callId: string;
  }): Promise<void> {
    await this.store.zrem(pendingCallsKey(conversationId), callId);
  }

  async dropLapsedPending({
    conversationId,
    lapsedAt,
  }: {
    conversationId: string;
    lapsedAt: number;
  }): Promise<void> {
    await this.store.zremrangebyscore(pendingCallsKey(conversationId), lapsedAt);
  }

  async findPendingIds({
    conversationId,
    from,
  }: {
    conversationId: string;
    from: number;
  }): Promise<string[]> {
    return this.store.zrangebyscore(pendingCallsKey(conversationId), from);
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
    return this.store.setIfAbsent(callKeepaliveKey(callId), String(at), ttlSeconds);
  }
}

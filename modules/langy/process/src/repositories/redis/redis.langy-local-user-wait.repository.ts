import type { SessionStateStore } from "@langwatch/redis-client/session-state";

import { turnWaitsKey, waitKey } from "../../rules/langy-local-control-keys.rules.ts";
import {
  storedUserWaitSchema,
  type StoredUserWait,
} from "../../rules/langy-local-user-wait-record.rules.ts";
import type { LocalRecordLookup } from "../langy-local-call.repository.ts";
import { LangyLocalUserWaitRepository } from "../langy-local-user-wait.repository.ts";

/** The user waits in the process's Redis, under the local-control key family. */
export class LangyLocalUserWaitRedisRepository extends LangyLocalUserWaitRepository {
  private readonly store: SessionStateStore;

  private constructor({ store }: { store: SessionStateStore }) {
    super();
    this.store = store;
  }

  static create({ store }: { store: SessionStateStore }): LangyLocalUserWaitRedisRepository {
    return new LangyLocalUserWaitRedisRepository({ store });
  }

  async save({ wait, ttlSeconds }: { wait: StoredUserWait; ttlSeconds: number }): Promise<void> {
    await this.store.set(waitKey(wait.waitId), JSON.stringify(wait), ttlSeconds);
  }

  async find(waitId: string): Promise<LocalRecordLookup<StoredUserWait>> {
    const raw = await this.store.tryGet(waitKey(waitId));
    if (!raw) return { kind: "miss" };
    try {
      return { kind: "hit", value: storedUserWaitSchema.parse(JSON.parse(raw)) };
    } catch (error) {
      return { kind: "unreadable", reasons: error instanceof Error ? [error] : [] };
    }
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
    await this.store.zadd({
      key: turnWaitsKey(conversationId, turnId),
      score: expiresAt,
      member: waitId,
      ttlSeconds,
    });
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
    await this.store.zrem(turnWaitsKey(conversationId, turnId), waitId);
  }

  async findPendingIds({
    conversationId,
    turnId,
  }: {
    conversationId: string;
    turnId: string;
  }): Promise<string[]> {
    return this.store.zrangebyscore(turnWaitsKey(conversationId, turnId), 0);
  }
}

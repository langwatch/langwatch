import type { SessionStateStore } from "@langwatch/redis-client/session-state";
import type { z } from "zod";

import {
  controlRequestClaimKey,
  controlRequestKey,
  conversationKeyBindingsKey,
  sessionKeyBindingKey,
  userRequestsKey,
} from "../../rules/langy-local-control-keys.rules.ts";
import type { LocalRecordLookup } from "../langy-local-call.repository.ts";
import {
  LangyLocalControlRequestRepository,
  sessionKeyBindingSchema,
  storedControlRequestSchema,
  type SessionKeyBinding,
  type StoredControlRequest,
} from "../langy-local-control-request.repository.ts";

/** The control requests and key bindings in the process's Redis, under the local-control keys. */
export class LangyLocalControlRequestRedisRepository extends LangyLocalControlRequestRepository {
  private readonly store: SessionStateStore;

  private constructor({ store }: { store: SessionStateStore }) {
    super();
    this.store = store;
  }

  static create({ store }: { store: SessionStateStore }): LangyLocalControlRequestRedisRepository {
    return new LangyLocalControlRequestRedisRepository({ store });
  }

  async saveRequest({
    request,
    ttlSeconds,
  }: {
    request: StoredControlRequest;
    ttlSeconds: number;
  }): Promise<void> {
    await this.store.set(controlRequestKey(request.id), JSON.stringify(request), ttlSeconds);
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
    await this.store.zadd({
      key: userRequestsKey(userId),
      score: expiresAt,
      member: requestId,
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
    await this.store.zremrangebyscore(userRequestsKey(userId), lapsedAt);
  }

  async findOpenRequestIds({ userId, from }: { userId: string; from: number }): Promise<string[]> {
    return this.store.zrangebyscore(userRequestsKey(userId), from);
  }

  async findRequest(requestId: string): Promise<LocalRecordLookup<StoredControlRequest>> {
    return parsed(
      await this.store.tryGet(controlRequestKey(requestId)),
      storedControlRequestSchema,
    );
  }

  async forgetRequest({ requestId, userId }: { requestId: string; userId: string }): Promise<void> {
    await this.store.del(controlRequestKey(requestId));
    await this.store.zrem(userRequestsKey(userId), requestId);
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
    return this.store.setIfAbsent(controlRequestClaimKey(requestId), userId, ttlSeconds);
  }

  async isClaimed(requestId: string): Promise<boolean> {
    return (await this.store.tryGet(controlRequestClaimKey(requestId))) !== null;
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
    await this.store.set(sessionKeyBindingKey(apiKeyId), JSON.stringify(binding), ttlSeconds);
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
    await this.store.zadd({
      key: conversationKeyBindingsKey(conversationId),
      score: lapsesAt,
      member: apiKeyId,
      ttlSeconds,
    });
  }

  async findKeyBinding(apiKeyId: string): Promise<LocalRecordLookup<SessionKeyBinding>> {
    return parsed(await this.store.tryGet(sessionKeyBindingKey(apiKeyId)), sessionKeyBindingSchema);
  }

  async deleteKeyBinding(apiKeyId: string): Promise<void> {
    await this.store.del(sessionKeyBindingKey(apiKeyId));
  }

  async unindexKeyBinding({
    conversationId,
    apiKeyId,
  }: {
    conversationId: string;
    apiKeyId: string;
  }): Promise<void> {
    await this.store.zrem(conversationKeyBindingsKey(conversationId), apiKeyId);
  }

  async findKeyBindingIds(conversationId: string): Promise<string[]> {
    return this.store.zrangebyscore(conversationKeyBindingsKey(conversationId), 0);
  }
}

/** A stored JSON value read as its schema; one that does not read is unreadable, not absent. */
function parsed<Schema extends z.ZodType>(
  raw: string | null,
  schema: Schema,
): LocalRecordLookup<z.output<Schema>> {
  if (!raw) return { kind: "miss" };
  try {
    return { kind: "hit", value: schema.parse(JSON.parse(raw)) };
  } catch (error) {
    return { kind: "unreadable", reasons: error instanceof Error ? [error] : [] };
  }
}

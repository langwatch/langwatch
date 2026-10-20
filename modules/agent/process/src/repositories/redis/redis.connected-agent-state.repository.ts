import {
  type StoredCall,
  type StoredResult,
  storedCallSchema,
  storedResultSchema,
} from "@langwatch/agent-contract";
import type { SessionStateStore } from "@langwatch/redis-client/session-state";
import type { z } from "zod";

import {
  callAckKey,
  callDeliveredKey,
  callKey,
  httpSessionKey,
  inflightKey,
  instanceMetaKey,
  instanceOwnerKey,
  instanceSetKey,
  pendingKey,
  resultKey,
  threadPinKey,
} from "../../rules/connected-agent-keys.rules.ts";
import {
  ConnectedAgentStateRepository,
  type InstanceMeta,
  type InstanceRecord,
  type StoredLookup,
  type StoredSession,
  storedSessionSchema,
  type ThreadPinLookup,
} from "../connected-agent-state.repository.ts";

/** The relay's state in Redis, under the key family of `connected-agent-keys.rules.ts`. */
export class RedisConnectedAgentStateRepository extends ConnectedAgentStateRepository {
  readonly #store: SessionStateStore;

  private constructor(store: SessionStateStore) {
    super();
    this.#store = store;
  }

  static create(store: SessionStateStore): RedisConnectedAgentStateRepository {
    return new RedisConnectedAgentStateRepository(store);
  }

  async saveInstance({
    meta,
    agentIds,
    ttlSeconds,
  }: InstanceRecord & { ttlSeconds: number }): Promise<void> {
    await this.#store.hset(
      instanceMetaKey(meta.projectId, meta.instanceId),
      fieldsOf({ meta, agentIds }),
      ttlSeconds,
    );
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
    const key = instanceMetaKey(projectId, instanceId);
    const current = await this.#store.tryHgetall(key);
    const fields = current ?? (restore ? fieldsOf(restore) : null);
    if (fields) await this.#store.hset(key, fields, ttlSeconds);
  }

  async findInstance({
    projectId,
    instanceId,
  }: {
    projectId: string;
    instanceId: string;
  }): Promise<InstanceRecord[]> {
    const fields = await this.#store.tryHgetall(instanceMetaKey(projectId, instanceId));
    if (!fields) return [];
    return [
      {
        meta: metaFromFields(fields),
        agentIds: fields.agentIds ? fields.agentIds.split(",").filter(Boolean) : [],
      },
    ];
  }

  async deleteInstance({
    projectId,
    instanceId,
  }: {
    projectId: string;
    instanceId: string;
  }): Promise<void> {
    await this.#store.del(instanceMetaKey(projectId, instanceId));
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
    await this.#store.zadd({
      key: instanceSetKey(projectId, agentId),
      score: seenAt,
      member: instanceId,
      ttlSeconds,
    });
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
    await this.#store.zaddLowerIfPresent(instanceSetKey(projectId, agentId), seenAt, instanceId);
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
    const key = instanceSetKey(projectId, agentId);
    await this.#store.zremrangebyscore(key, cutoff);
    return this.#store.zrangebyscore(key, cutoff);
  }

  async countInflight({
    projectId,
    instanceId,
  }: {
    projectId: string;
    instanceId: string;
  }): Promise<number> {
    return Number((await this.#store.tryGet(inflightKey(projectId, instanceId))) ?? 0);
  }

  incrementInflight({
    projectId,
    instanceId,
    ttlSeconds,
  }: {
    projectId: string;
    instanceId: string;
    ttlSeconds: number;
  }): Promise<number> {
    return this.#store.incr(inflightKey(projectId, instanceId), ttlSeconds);
  }

  decrementInflight({
    projectId,
    instanceId,
  }: {
    projectId: string;
    instanceId: string;
  }): Promise<number> {
    return this.#store.decr(inflightKey(projectId, instanceId));
  }

  claimInstanceOwner({
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
    return this.#store.setIfAbsentOrEqual(
      instanceOwnerKey(projectId, instanceId),
      principalId,
      ttlSeconds,
    );
  }

  async saveCall({ call, ttlSeconds }: { call: StoredCall; ttlSeconds: number }): Promise<void> {
    await this.#store.set(
      callKey(call.projectId, call.envelope.callId),
      JSON.stringify(call),
      ttlSeconds,
    );
  }

  async readCall({
    projectId,
    callId,
  }: {
    projectId: string;
    callId: string;
  }): Promise<StoredLookup<StoredCall>> {
    return lookupOf(storedCallSchema, await this.#store.tryGet(callKey(projectId, callId)));
  }

  async deleteCall({ projectId, callId }: { projectId: string; callId: string }): Promise<void> {
    await this.#store.del(callKey(projectId, callId));
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
    await this.#store.set(callAckKey(projectId, callId), "1", ttlSeconds);
  }

  claimCallDelivery({
    projectId,
    callId,
    ttlSeconds,
  }: {
    projectId: string;
    callId: string;
    ttlSeconds: number;
  }): Promise<boolean> {
    return this.#store.setIfAbsent(callDeliveredKey(projectId, callId), "1", ttlSeconds);
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
    await this.#store.zadd({
      key: pendingKey(projectId, instanceId),
      score: deadlineAt,
      member: callId,
      ttlSeconds,
    });
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
    await this.#store.zrem(pendingKey(projectId, instanceId), callId);
  }

  findPendingCallIds({
    projectId,
    instanceId,
    from,
  }: {
    projectId: string;
    instanceId: string;
    from: number;
  }): Promise<string[]> {
    return this.#store.zrangebyscore(pendingKey(projectId, instanceId), from);
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
    await this.#store.set(resultKey(projectId, callId), JSON.stringify(result), ttlSeconds);
  }

  async readResult({
    projectId,
    callId,
  }: {
    projectId: string;
    callId: string;
  }): Promise<StoredLookup<StoredResult>> {
    return lookupOf(storedResultSchema, await this.#store.tryGet(resultKey(projectId, callId)));
  }

  async saveHttpSession({
    session,
    ttlSeconds,
  }: {
    session: StoredSession;
    ttlSeconds: number;
  }): Promise<void> {
    await this.#store.set(
      httpSessionKey(session.projectId, session.token),
      JSON.stringify(session),
      ttlSeconds,
    );
  }

  async readHttpSession({
    projectId,
    token,
  }: {
    projectId: string;
    token: string;
  }): Promise<StoredLookup<StoredSession>> {
    return lookupOf(
      storedSessionSchema,
      await this.#store.tryGet(httpSessionKey(projectId, token)),
    );
  }

  async deleteHttpSession({
    projectId,
    token,
  }: {
    projectId: string;
    token: string;
  }): Promise<void> {
    await this.#store.del(httpSessionKey(projectId, token));
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
    await this.#store.set(threadPinKey(projectId, agentId, threadId), instanceId, ttlSeconds);
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
    const instanceId = await this.#store.tryGet(threadPinKey(projectId, agentId, threadId));
    return instanceId ? { kind: "pinned", instanceId } : { kind: "unpinned" };
  }
}

/** A stored JSON value read against its schema; an unparseable value reads as unreadable. */
function lookupOf<Schema extends z.ZodType>(
  schema: Schema,
  raw: string | null,
): StoredLookup<z.output<Schema>> {
  if (!raw) return { kind: "miss" };
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? { kind: "hit", value: parsed.data } : { kind: "unreadable" };
  } catch {
    return { kind: "unreadable" };
  }
}

function fieldsOf({ meta, agentIds }: InstanceRecord): Record<string, string> {
  return {
    instanceId: meta.instanceId,
    projectId: meta.projectId,
    hostname: meta.hostname,
    username: meta.username,
    pid: String(meta.pid),
    sdkName: meta.sdk.name,
    sdkVersion: meta.sdk.version,
    sdkLanguage: meta.sdk.language,
    label: meta.label ?? "",
    podId: meta.podId,
    connectedAt: String(meta.connectedAt),
    maxConcurrency: String(meta.maxConcurrency),
    agentIds: agentIds.join(","),
  };
}

/** One field of the hash as text, empty when the hash misses it. */
function textOf({ fields, name }: { fields: Record<string, string>; name: string }): string {
  return fields[name] ?? "";
}

function metaFromFields(fields: Record<string, string>): InstanceMeta {
  return {
    instanceId: textOf({ fields, name: "instanceId" }),
    projectId: textOf({ fields, name: "projectId" }),
    hostname: textOf({ fields, name: "hostname" }),
    username: textOf({ fields, name: "username" }),
    pid: Number(textOf({ fields, name: "pid" })),
    sdk: {
      name: textOf({ fields, name: "sdkName" }),
      version: textOf({ fields, name: "sdkVersion" }),
      language: textOf({ fields, name: "sdkLanguage" }),
    },
    label: fields.label ? fields.label : null,
    podId: textOf({ fields, name: "podId" }),
    connectedAt: Number(textOf({ fields, name: "connectedAt" })),
    maxConcurrency: Math.max(1, Number(textOf({ fields, name: "maxConcurrency" }))),
  };
}

/**
 * Presence of connected agent instances (ADR-128, "Presence").
 */

import {
  MAX_CALL_TIMEOUT_MS,
  PRESENCE_TTL_SECONDS,
  RESULT_TTL_SECONDS,
} from "@langwatch/agent-contract";

import { inflightKey, instanceMetaKey, instanceSetKey } from "../rules/connected-agent-keys.rules";
import type { AgentStateStorePort } from "../ports/agent-state-store.port";
import {
  ConnectedAgentRegistryPort,
  type InstanceMeta,
  type LiveInstance,
} from "../ports/connected-agent-runtime.port";

/** How long a retired member stays readable: it is gone at once. */
const RETIRED_SCORE_OFFSET_MS = PRESENCE_TTL_SECONDS * 1000;

/**
 * The per-instance call counter outlives the longest call and its slack, so
 * a counter that was never decremented (a pod died mid-call) clears itself.
 */
const INFLIGHT_TTL_SECONDS = Math.ceil(MAX_CALL_TIMEOUT_MS / 1000) + RESULT_TTL_SECONDS;

export class ConnectedAgentRegistryAdapter extends ConnectedAgentRegistryPort {
  static create(store: AgentStateStorePort): ConnectedAgentRegistryAdapter {
    return new ConnectedAgentRegistryAdapter(store);
  }

  private constructor(private readonly store: AgentStateStorePort) {
    super();
  }

  /** Records a live instance under every agent it registered. */
  async register({
    meta,
    agentIds,
    now = Date.now(),
  }: {
    meta: InstanceMeta;
    agentIds: string[];
    now?: number;
  }): Promise<void> {
    await this.store.hset(
      instanceMetaKey(meta.projectId, meta.instanceId),
      fieldsOf({ meta, agentIds }),
      PRESENCE_TTL_SECONDS,
    );
    await this.refresh({
      projectId: meta.projectId,
      instanceId: meta.instanceId,
      agentIds,
      now,
    });
  }

  /**
   * Refreshes the last-seen score of an instance on every agent it serves.
   */
  async refresh({
    projectId,
    instanceId,
    agentIds,
    now = Date.now(),
    meta,
  }: {
    projectId: string;
    instanceId: string;
    agentIds: string[];
    now?: number;
    meta?: InstanceMeta;
  }): Promise<void> {
    await Promise.all([
      ...agentIds.map((agentId) =>
        this.store.zadd({
          key: instanceSetKey(projectId, agentId),
          score: now,
          member: instanceId,
          ttlSeconds: PRESENCE_TTL_SECONDS,
        }),
      ),
      this.touchMeta({ projectId, instanceId, agentIds, meta }),
    ]);
  }

  /** Extends the meta hash without rewriting it, or restores it from `meta`. */
  private async touchMeta({
    projectId,
    instanceId,
    agentIds,
    meta,
  }: {
    projectId: string;
    instanceId: string;
    agentIds: string[];
    meta: InstanceMeta | undefined;
  }): Promise<void> {
    const key = instanceMetaKey(projectId, instanceId);
    const current = await this.store.hgetall(key);
    const fields = current ?? (meta ? fieldsOf({ meta, agentIds }) : null);
    if (fields) {
      await this.store.hset(key, fields, PRESENCE_TTL_SECONDS);
    }
  }

  /**
   * Retires an instance at once: the score drops out of the live window, and
   * only ever drops, so a late goodbye cannot revive an aged-out member.
   */
  async deregister({
    projectId,
    instanceId,
    agentIds,
    now = Date.now(),
  }: {
    projectId: string;
    instanceId: string;
    agentIds: string[];
    now?: number;
  }): Promise<void> {
    const retiredScore = now - RETIRED_SCORE_OFFSET_MS;
    await Promise.all(
      agentIds.map((agentId) =>
        this.store.zaddLowerIfPresent(instanceSetKey(projectId, agentId), retiredScore, instanceId),
      ),
    );
    await this.store.del(instanceMetaKey(projectId, instanceId));
  }

  /** The live instances of one agent, with their in-flight counts. */
  async listLive({
    projectId,
    agentId,
    now = Date.now(),
  }: {
    projectId: string;
    agentId: string;
    now?: number;
  }): Promise<LiveInstance[]> {
    const key = instanceSetKey(projectId, agentId);
    const cutoff = now - PRESENCE_TTL_SECONDS * 1000;
    await this.store.zremrangebyscore(key, cutoff);
    const instanceIds = await this.store.zrangebyscore(key, cutoff);
    const live = await Promise.all(
      instanceIds.map(async (instanceId) => {
        const [fields, inflightRaw] = await Promise.all([
          this.store.hgetall(instanceMetaKey(projectId, instanceId)),
          this.store.get(inflightKey(projectId, instanceId)),
        ]);
        if (!fields) return null;
        return {
          ...metaFromFields(fields),
          inflight: Number(inflightRaw ?? 0),
          lastSeenAt: now,
        };
      }),
    );
    return live.filter((entry): entry is LiveInstance => entry !== null);
  }

  /** Whether one instance is still live for one agent. */
  async isLive({
    projectId,
    agentId,
    instanceId,
    now = Date.now(),
  }: {
    projectId: string;
    agentId: string;
    instanceId: string;
    now?: number;
  }): Promise<boolean> {
    const live = await this.listLive({ projectId, agentId, now });
    return live.some((instance) => instance.instanceId === instanceId);
  }

  /** The agent ids one instance registered, read off its meta hash. */
  async agentIdsOf({
    projectId,
    instanceId,
  }: {
    projectId: string;
    instanceId: string;
  }): Promise<string[]> {
    const fields = await this.store.hgetall(instanceMetaKey(projectId, instanceId));
    return fields?.agentIds ? fields.agentIds.split(",").filter(Boolean) : [];
  }

  async incrementInflight({
    projectId,
    instanceId,
  }: {
    projectId: string;
    instanceId: string;
  }): Promise<number> {
    return this.store.incr(inflightKey(projectId, instanceId), INFLIGHT_TTL_SECONDS);
  }

  async decrementInflight({
    projectId,
    instanceId,
  }: {
    projectId: string;
    instanceId: string;
  }): Promise<number> {
    return this.store.decr(inflightKey(projectId, instanceId));
  }
}

function fieldsOf({
  meta,
  agentIds,
}: {
  meta: InstanceMeta;
  agentIds: string[];
}): Record<string, string> {
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

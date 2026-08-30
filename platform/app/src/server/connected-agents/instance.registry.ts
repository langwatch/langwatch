/**
 * Presence of connected agent instances (ADR-128, "Presence").
 *
 * One sorted set per agent holds its live instance ids scored by last seen,
 * with the same TTL, refresh and retirement rules as the scenario tab
 * registry: a member ages out on its own when its socket dies without a
 * goodbye, and a goodbye only ever lowers a score. A hash per instance keeps
 * what the agents page shows, and a counter per instance keeps the calls in
 * flight for the concurrency pick.
 */

import {
  MAX_CALL_TIMEOUT_MS,
  PRESENCE_TTL_SECONDS,
  RESULT_TTL_SECONDS,
} from "./constants";
import { inflightKey, instanceMetaKey, instanceSetKey } from "./keys";
import type { AgentStateStore } from "./state-store";

/** What one instance says about itself, as the agents page shows it. */
export interface InstanceMeta {
  instanceId: string;
  projectId: string;
  hostname: string;
  username: string;
  pid: number;
  sdk: { name: string; version: string; language: string };
  label: string | null;
  /** The app replica that holds the socket. */
  podId: string;
  connectedAt: number;
  maxConcurrency: number;
}

/** A live instance with the calls it has in flight. */
export interface LiveInstance extends InstanceMeta {
  inflight: number;
  lastSeenAt: number;
}

/** How long a retired member stays readable: it is gone at once. */
const RETIRED_SCORE_OFFSET_MS = PRESENCE_TTL_SECONDS * 1000;

/**
 * The per-instance call counter outlives the longest call and its slack, so
 * a counter that was never decremented (a pod died mid-call) clears itself.
 */
const INFLIGHT_TTL_SECONDS =
  Math.ceil(MAX_CALL_TIMEOUT_MS / 1000) + RESULT_TTL_SECONDS;

export class InstanceRegistry {
  constructor(private readonly store: AgentStateStore) {}

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
      instanceMetaKey(meta.instanceId),
      fieldsOf(meta, agentIds),
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
   *
   * With `meta`, a hash that aged out while the instance was still there (a
   * stalled pod, a poll later than the TTL) is written again, so the
   * instance reads live instead of vanishing until it registers again.
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
        this.store.zadd(
          instanceSetKey(projectId, agentId),
          now,
          instanceId,
          PRESENCE_TTL_SECONDS,
        ),
      ),
      this.touchMeta({ instanceId, agentIds, meta }),
    ]);
  }

  /** Extends the meta hash without rewriting it, or restores it from `meta`. */
  private async touchMeta({
    instanceId,
    agentIds,
    meta,
  }: {
    instanceId: string;
    agentIds: string[];
    meta: InstanceMeta | undefined;
  }): Promise<void> {
    const current = await this.store.hgetall(instanceMetaKey(instanceId));
    const fields = current ?? (meta ? fieldsOf(meta, agentIds) : null);
    if (fields) {
      await this.store.hset(
        instanceMetaKey(instanceId),
        fields,
        PRESENCE_TTL_SECONDS,
      );
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
        this.store.zaddLowerIfPresent(
          instanceSetKey(projectId, agentId),
          retiredScore,
          instanceId,
        ),
      ),
    );
    await this.store.del(instanceMetaKey(instanceId));
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
          this.store.hgetall(instanceMetaKey(instanceId)),
          this.store.get(inflightKey(instanceId)),
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
  async agentIdsOf(instanceId: string): Promise<string[]> {
    const fields = await this.store.hgetall(instanceMetaKey(instanceId));
    return fields?.agentIds ? fields.agentIds.split(",").filter(Boolean) : [];
  }

  async incrementInflight(instanceId: string): Promise<number> {
    return this.store.incr(inflightKey(instanceId), INFLIGHT_TTL_SECONDS);
  }

  async decrementInflight(instanceId: string): Promise<number> {
    return this.store.decr(inflightKey(instanceId));
  }
}

function fieldsOf(
  meta: InstanceMeta,
  agentIds: string[],
): Record<string, string> {
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

function metaFromFields(fields: Record<string, string>): InstanceMeta {
  return {
    instanceId: fields.instanceId ?? "",
    projectId: fields.projectId ?? "",
    hostname: fields.hostname ?? "",
    username: fields.username ?? "",
    pid: Number(fields.pid ?? 0),
    sdk: {
      name: fields.sdkName ?? "",
      version: fields.sdkVersion ?? "",
      language: fields.sdkLanguage ?? "",
    },
    label: fields.label ? fields.label : null,
    podId: fields.podId ?? "",
    connectedAt: Number(fields.connectedAt ?? 0),
    maxConcurrency: Math.max(1, Number(fields.maxConcurrency ?? 1)),
  };
}

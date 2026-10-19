/**
 * Presence of connected agent instances (ADR-128, "Presence").
 */

import {
  MAX_CALL_TIMEOUT_MS,
  PRESENCE_TTL_SECONDS,
  RESULT_TTL_SECONDS,
} from "@langwatch/agent-contract";
import { nowInstant } from "@langwatch/time";

import type {
  ConnectedAgentStateRepository,
  InstanceMeta,
} from "../repositories/connected-agent-state.repository.ts";
import type { LiveInstance } from "../services/connected-agent-runtime.service.ts";

/** How long a retired member stays readable: it is gone at once. */
const RETIRED_SCORE_OFFSET_MS = PRESENCE_TTL_SECONDS * 1000;

/**
 * The per-instance call counter outlives the longest call and its slack, so
 * a counter that was never decremented (a pod died mid-call) clears itself.
 */
const INFLIGHT_TTL_SECONDS = Math.ceil(MAX_CALL_TIMEOUT_MS / 1000) + RESULT_TTL_SECONDS;

export class ConnectedAgentRegistryService {
  static create(state: ConnectedAgentStateRepository): ConnectedAgentRegistryService {
    return new ConnectedAgentRegistryService(state);
  }

  readonly #state: ConnectedAgentStateRepository;

  private constructor(state: ConnectedAgentStateRepository) {
    this.#state = state;
  }

  /** Records a live instance under every agent it registered. */
  async register({
    meta,
    agentIds,
    now = nowInstant().epochMilliseconds,
  }: {
    meta: InstanceMeta;
    agentIds: string[];
    now?: number;
  }): Promise<void> {
    await this.#state.saveInstance({ meta, agentIds, ttlSeconds: PRESENCE_TTL_SECONDS });
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
    now = nowInstant().epochMilliseconds,
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
        this.#state.markInstanceSeen({
          projectId,
          agentId,
          instanceId,
          seenAt: now,
          ttlSeconds: PRESENCE_TTL_SECONDS,
        }),
      ),
      // Extends the record without rewriting it, or restores it from `meta`.
      this.#state.extendInstance({
        projectId,
        instanceId,
        restore: meta ? { meta, agentIds } : undefined,
        ttlSeconds: PRESENCE_TTL_SECONDS,
      }),
    ]);
  }

  /**
   * Retires an instance at once: the score drops out of the live window, and
   * only ever drops, so a late goodbye cannot revive an aged-out member.
   */
  async deregister({
    projectId,
    instanceId,
    agentIds,
    now = nowInstant().epochMilliseconds,
  }: {
    projectId: string;
    instanceId: string;
    agentIds: string[];
    now?: number;
  }): Promise<void> {
    const retiredScore = now - RETIRED_SCORE_OFFSET_MS;
    await Promise.all(
      agentIds.map((agentId) =>
        this.#state.lowerInstanceSeen({ projectId, agentId, instanceId, seenAt: retiredScore }),
      ),
    );
    await this.#state.deleteInstance({ projectId, instanceId });
  }

  /** The live instances of one agent, with their in-flight counts. */
  async listLive({
    projectId,
    agentId,
    now = nowInstant().epochMilliseconds,
  }: {
    projectId: string;
    agentId: string;
    now?: number;
  }): Promise<LiveInstance[]> {
    const cutoff = now - PRESENCE_TTL_SECONDS * 1000;
    const instanceIds = await this.#state.pruneSeenInstanceIds({ projectId, agentId, cutoff });
    const live = await Promise.all(
      instanceIds.map(async (instanceId) => {
        const [records, inflight] = await Promise.all([
          this.#state.findInstance({ projectId, instanceId }),
          this.#state.countInflight({ projectId, instanceId }),
        ]);
        return records.map((record) => ({ ...record.meta, inflight, lastSeenAt: now }));
      }),
    );
    return live.flat();
  }

  /** Whether one instance is still live for one agent. */
  async isLive({
    projectId,
    agentId,
    instanceId,
    now = nowInstant().epochMilliseconds,
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
    const records = await this.#state.findInstance({ projectId, instanceId });
    return records.flatMap((record) => record.agentIds);
  }

  async incrementInflight({
    projectId,
    instanceId,
  }: {
    projectId: string;
    instanceId: string;
  }): Promise<number> {
    return this.#state.incrementInflight({
      projectId,
      instanceId,
      ttlSeconds: INFLIGHT_TTL_SECONDS,
    });
  }

  async decrementInflight({
    projectId,
    instanceId,
  }: {
    projectId: string;
    instanceId: string;
  }): Promise<number> {
    return this.#state.decrementInflight({ projectId, instanceId });
  }
}

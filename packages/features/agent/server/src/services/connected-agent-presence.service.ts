/**
 * What the agents list and the agent detail read about presence: whether a
 * connected agent is online, and which instances hold it (ADR-128).
 */

import {
  connectedAgentSelectability,
  type Agent,
  type ConnectedAgentSelectability,
} from "@langwatch/agent-contract";
import { createLogger } from "@langwatch/observability";
import { Temporal, toDate } from "@langwatch/time";
import type { ConnectedAgentRuntime, LiveInstance } from "../ports/connected-agent-runtime.port.ts";

const logger = createLogger("langwatch:connected-agents:presence");

export type AgentPresenceStatus = "online" | "offline";

/** One instance as the agents page shows it. */
export interface AgentInstanceView {
  instanceId: string;
  hostname: string;
  username: string;
  pid: number;
  label: string | null;
  sdk: { name: string; version: string; language: string };
  connectedAt: Agent["createdAt"];
  inflight: number;
  maxConcurrency: number;
}

export interface AgentPresence {
  status: AgentPresenceStatus;
  instances: AgentInstanceView[];
}

/** Presence for an agent that can never be connected: offline, nothing. */
export const NO_PRESENCE: AgentPresence = { status: "offline", instances: [] };

/** The owner of an agent, as every surface reports it. */
export interface AgentOwnerView {
  userId: string;
  name: string | null;
}

/**
 * The owner, the presence and the selectability of one agent, as the response
 * schemas declare them. A row a caller may read but may not choose is answered
 * all the same, marked with the reason, so the client can show it and say why
 * it is not on offer.
 */
export class ConnectedAgentPresenceService {
  static create(): ConnectedAgentPresenceService {
    return new ConnectedAgentPresenceService();
  }

  static agentPresenceView({
    agent,
    owners,
    presence,
    viewerUserId,
  }: {
    agent: { id: string; ownerUserId: string | null };
    owners: Map<string, AgentOwnerView>;
    presence: Map<string, AgentPresence>;
    /** The person behind the caller; nothing for a key that names none. */
    viewerUserId?: string | null;
  }): { owner: AgentOwnerView | null } & AgentPresence & ConnectedAgentSelectability {
    const { status, instances } = presence.get(agent.id) ?? NO_PRESENCE;

    return {
      owner: agent.ownerUserId
        ? (owners.get(agent.ownerUserId) ?? {
            userId: agent.ownerUserId,
            name: null,
          })
        : null,
      status,
      instances,
      ...connectedAgentSelectability({
        ownerUserId: agent.ownerUserId,
        viewerUserId,
      }),
    };
  }

  /** The presence of every agent given, keyed by id; non-connected ones are offline. */
  static async readAgentPresence({
    projectId,
    agents,
    runtime,
  }: {
    projectId: string;
    agents: readonly { id: string; type: string }[];
    runtime: ConnectedAgentRuntime;
  }): Promise<Map<string, AgentPresence>> {
    const registry = runtime.registry;
    const entries = await Promise.all(
      agents.map(async (agent): Promise<[string, AgentPresence]> => {
        if (agent.type !== "connected") {
          return [agent.id, NO_PRESENCE];
        }

        try {
          const live = await registry.listLive({ projectId, agentId: agent.id });

          return [
            agent.id,
            {
              status: live.length > 0 ? "online" : "offline",
              instances: live.map(toView),
            },
          ];
        } catch (error) {
          // Presence is display data: one unreadable agent shows as offline
          // rather than taking the whole list down with it.
          logger.warn(
            { error, projectId, agentId: agent.id },
            "presence read failed, reporting the agent as offline",
          );

          return [agent.id, NO_PRESENCE];
        }
      }),
    );

    return new Map(entries);
  }

  private constructor() {}
}

function toView(instance: LiveInstance): AgentInstanceView {
  return {
    instanceId: instance.instanceId,
    hostname: instance.hostname,
    username: instance.username,
    pid: instance.pid,
    label: instance.label,
    sdk: instance.sdk,
    connectedAt: toDate(Temporal.Instant.fromEpochMilliseconds(instance.connectedAt)),
    inflight: instance.inflight,
    maxConcurrency: instance.maxConcurrency,
  };
}

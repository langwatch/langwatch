/**
 * What the agents list and the agent detail read about presence: whether a
 * connected agent is online, and which instances hold it (ADR-128).
 *
 * Read off the registry of this process's runtime, so a list of fifty agents
 * costs fifty sorted-set reads and no database round trip.
 */

import { createLogger } from "@langwatch/observability";
import type { LiveInstance } from "./instance.registry";
import { getConnectedAgentRuntime } from "./runtime";

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
  connectedAt: Date;
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
 * The owner and the presence of one agent, as the response schemas declare
 * them.
 *
 * Both the REST routes and the tRPC router answer with these three fields, so
 * the fold lives here beside the presence it reads. An owner the name lookup
 * missed still reports its id, because the row knows the agent belongs to
 * somebody even when the person cannot be named.
 */
export function agentPresenceView({
  agent,
  owners,
  presence,
}: {
  agent: { id: string; ownerUserId: string | null };
  owners: Map<string, AgentOwnerView>;
  presence: Map<string, AgentPresence>;
}): { owner: AgentOwnerView | null } & AgentPresence {
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
  };
}

function toView(instance: LiveInstance): AgentInstanceView {
  return {
    instanceId: instance.instanceId,
    hostname: instance.hostname,
    username: instance.username,
    pid: instance.pid,
    label: instance.label,
    sdk: instance.sdk,
    connectedAt: new Date(instance.connectedAt),
    inflight: instance.inflight,
    maxConcurrency: instance.maxConcurrency,
  };
}

/** The presence of every agent given, keyed by id; non-connected ones are offline. */
export async function readAgentPresence({
  projectId,
  agents,
}: {
  projectId: string;
  agents: { id: string; type: string }[];
}): Promise<Map<string, AgentPresence>> {
  const registry = getConnectedAgentRuntime().registry;
  const entries = await Promise.all(
    agents.map(async (agent): Promise<[string, AgentPresence]> => {
      if (agent.type !== "connected") return [agent.id, NO_PRESENCE];
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

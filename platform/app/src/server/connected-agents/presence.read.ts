/**
 * What the agents list and the agent detail read about presence: whether a
 * connected agent is online, and which instances hold it (ADR-128).
 *
 * Read off the registry of this process's runtime, so a list of fifty agents
 * costs fifty sorted-set reads and no database round trip.
 */

import type { LiveInstance } from "./instance.registry";
import { getConnectedAgentRuntime } from "./runtime";

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
      const live = await registry.listLive({ projectId, agentId: agent.id });
      return [
        agent.id,
        {
          status: live.length > 0 ? "online" : "offline",
          instances: live.map(toView),
        },
      ];
    }),
  );
  return new Map(entries);
}

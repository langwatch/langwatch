import type { AgentOverview } from "@langwatch/agent-contract";
import type { WireOf } from "@langwatch/api/web";
import { useMemo } from "react";

import type { ConnectedAgentBrowser } from "../model/agent-client.ts";
import { useAgentManagementHost } from "../model/agent-management-host.ts";
import { agentApi } from "./agent-api.ts";

type AgentListItem = WireOf<AgentOverview>;

/** The connected agents of a project's list, as the connected-agent card and drawer read them. */
export function connectedAgentsOf(items: readonly AgentListItem[]): ConnectedAgentBrowser[] {
  return items
    .filter((agent) => agent.type === "connected")
    .map((agent) => ({
      id: agent.id,
      name: agent.name,
      environment: agent.environment ?? null,
      hostLabel: agent.hostLabel ?? null,
      lastSeenAt: agent.lastSeenAt ?? null,
      status: agent.status,
      instances: agent.instances,
      owner: agent.owner,
      selectable: agent.selectable,
      notSelectableReason: agent.notSelectableReason,
      parameters: agent.parameters,
      config: agent.config,
    }));
}

/** One connected agent, read by the id its address carries. */
export function useConnectedAgentDetail(agentId: string | undefined) {
  const project = useAgentManagementHost().project();
  const query = agentApi.agents.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: Boolean(project) },
  );
  const agent = useMemo(
    () => connectedAgentsOf(query.data ?? []).find((candidate) => candidate.id === agentId),
    [query.data, agentId],
  );
  return { agent, isLoading: query.isLoading, projectId: project?.id ?? "" };
}

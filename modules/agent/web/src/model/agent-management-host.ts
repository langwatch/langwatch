import { createContext, useContext } from "react";
import type { AgentClient } from "./agent-client.ts";

export type AgentHostProject = {
  id: string;
  slug: string;
  name?: string;
};

export type AgentCopyTarget = {
  label: string;
  value: string;
  hasCreatePermission: boolean;
};

export type AgentRouteReading = {
  params: Readonly<Record<string, string | undefined>>;
  query: Readonly<Record<string, string | undefined>>;
};

export type AgentSuccessNotice = {
  title: string;
  description?: string;
  id?: string;
};

export type AgentFailureNotice = {
  error: unknown;
  fallbackTitle: string;
  id?: string;
};

export type AgentEditorDrawer = "agentCodeEditor" | "agentHttpEditor" | "agentWorkflowEditor";

export interface AgentManagementHost {
  project(): AgentHostProject | undefined;

  agents(): AgentClient;

  copyTargets(): readonly AgentCopyTarget[];

  route(): AgentRouteReading;

  setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void;

  navigate(to: string): void;

  succeeded(notice: AgentSuccessNotice): void;

  failed(failure: AgentFailureNotice): void;

  describeFailure(failure: AgentFailureNotice): string;

  openAgentEditor(input: { drawer: AgentEditorDrawer; agentId?: string }): void;

  openConnectedAgent(agentId: string): void;

  openTestRun(run: { scenarioRunId: string; batchRunId: string }): void;

  refreshAgentLimit(): Promise<void>;
}

const AgentManagementHostContext = createContext<AgentManagementHost | undefined>(void 0);

export const AgentManagementHostProvider = AgentManagementHostContext.Provider;

export function useAgentManagementHost(): AgentManagementHost {
  const host = useContext(AgentManagementHostContext);
  if (!host) {
    throw new Error(
      "No Agents host is mounted above this screen; render it inside the agent frontend feature.",
    );
  }
  return host;
}

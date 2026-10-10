import { useAgentManagementHost, type AgentEditorDrawer } from "../model/agent-management-host.ts";
import { agentApi } from "./agent-api.ts";
import type { AgentListArchiveOptions } from "./use-agent-list-archive.ts";
import { useAgents } from "./use-agents.ts";

const EDITOR_BY_TYPE: Record<string, AgentEditorDrawer> = {
  http: "agentHttpEditor",
  workflow: "agentWorkflowEditor",
  voice: "agentVoiceEditor",
};

/** What the agent list drawer reads and does when the address opened it. */
export function useRoutedAgentList() {
  const host = useAgentManagementHost();
  const projectId = host.project()?.id ?? "";
  const utils = agentApi.useUtils();
  const query = useAgents({ projectId });
  const client = host.agents();
  const refresh = () => utils.agents.getAll.invalidate({ projectId });

  const archive: AgentListArchiveOptions = {
    onGetRelated: (id) => client.relatedEntities({ id, projectId }),
    onDelete: async (id) => {
      await client.archive({ id, projectId });
    },
    onCascadeArchive: (id) => client.cascadeArchive({ id, projectId }),
    onArchived: (workflowArchived) => {
      void refresh();
      host.succeeded({
        title: "Agent deleted",
        ...(workflowArchived ? { description: "Also deleted: 1 workflow" } : {}),
      });
    },
    onError: (error) => host.failed({ error, fallbackTitle: "Error deleting agent" }),
  };

  return {
    archive,
    items: query.data ?? [],
    isLoading: query.isLoading,
    errorMessage: query.error
      ? host.describeFailure({ error: query.error, fallbackTitle: "Couldn't load agents" })
      : undefined,
    edit: (agent: { id: string; type: string }) =>
      host.openAgentEditor({
        drawer: EDITOR_BY_TYPE[agent.type] ?? "agentCodeEditor",
        agentId: agent.id,
      }),
  };
}

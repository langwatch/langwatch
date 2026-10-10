import type { AgentBrowser } from "../model/agent-client.ts";
import { useAgentManagementHost } from "../model/agent-management-host.ts";
import { agentApi } from "./agent-api.ts";
import type { AgentCodeEditorOptions } from "./use-agent-code-editor.ts";

/** What the code agent editor reads and writes when the address opened it (main's editor). */
export function useRoutedCodeAgent({
  agentId,
  onSave,
  close,
}: {
  agentId?: string;
  onSave?: (agent: AgentBrowser) => void;
  close: () => void;
}) {
  const host = useAgentManagementHost();
  const projectId = host.project()?.id ?? "";
  const utils = agentApi.useUtils();
  const agentQuery = agentApi.agents.getById.useQuery(
    { id: agentId ?? "", projectId },
    { enabled: Boolean(agentId && projectId) },
  );
  const create = agentApi.agents.create.useMutation();
  const update = agentApi.agents.update.useMutation();

  const options: AgentCodeEditorOptions = {
    open: true,
    ...(agentId ? { agentId } : {}),
    agent: agentQuery.data ?? null,
    projectId,
    onClose: close,
    ...(onSave ? { onSave } : {}),
    onCreate: async (input) => {
      const agent = await create.mutateAsync({ ...input, type: "code" });
      await utils.agents.getAll.invalidate({ projectId });
      return agent;
    },
    onUpdate: async (input) => {
      const agent = await update.mutateAsync(input);
      await utils.agents.getAll.invalidate({ projectId });
      return agent;
    },
    onError: (error) => host.failed({ error, fallbackTitle: "Couldn't save the code agent" }),
  };
  return { options, isLoading: agentQuery.isLoading && Boolean(agentId) };
}

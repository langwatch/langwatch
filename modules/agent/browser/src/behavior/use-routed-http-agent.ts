import { httpAgentTestInputSchema } from "@langwatch/agent-contract";
import type { HttpTestErrorExplanation, HttpTestResult } from "@langwatch/agent-contract/http-test";

import type { AgentBrowser } from "../model/agent-client.ts";
import { useAgentManagementHost } from "../model/agent-management-host.ts";
import { agentApi } from "./agent-api.ts";
import type { HttpAgentEditorOptions } from "./use-http-agent-editor.ts";

const explainTestError: HttpTestErrorExplanation = ({ error }) => ({
  title: "The test request failed",
  ...(error ? { description: error } : {}),
});

/** What the HTTP agent editor reads and writes when the address opened it (main's editor). */
export function useRoutedHttpAgent({
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
  const test = agentApi.httpProxy.execute.useMutation();

  const options: HttpAgentEditorOptions = {
    open: true,
    ...(agentId ? { agentId } : {}),
    agent: agentQuery.data ?? null,
    isLoadingAgent: agentQuery.isLoading,
    isSaving: create.isPending || update.isPending,
    projectId,
    onClose: close,
    ...(onSave ? { onSave } : {}),
    onCreate: async (input) => {
      const agent = await create.mutateAsync({ ...input, type: "http" });
      await utils.agents.getAll.invalidate({ projectId });
      return agent;
    },
    onUpdate: async (input) => {
      const agent = await update.mutateAsync(input);
      await utils.agents.getAll.invalidate({ projectId });
      return agent;
    },
    onTest: async ({ templateVariables, ...request }): Promise<HttpTestResult> =>
      test.mutateAsync({
        ...request,
        projectId,
        templateVariables:
          httpAgentTestInputSchema.shape.templateVariables.parse(templateVariables),
      }),
    onSaveError: (failure) => host.failed(failure),
  };
  return { options, explainTestError };
}

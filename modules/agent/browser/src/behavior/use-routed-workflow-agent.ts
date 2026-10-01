import { findLinkedWorkflowIds, type Field } from "@langwatch/agent-contract";
import type { UiWorkflowAgentEditorOptions } from "@langwatch/browser-host/drawer";
import { computeBestMatchMappings } from "@langwatch/scenario-contract";
import { getMappingSurfaceInputs, studioWorkflowSchema } from "@langwatch/workflow-contract";

import type { AgentBrowser } from "../model/agent-client.ts";
import { useAgentManagementHost } from "../model/agent-management-host.ts";
import { agentApi } from "./agent-api.ts";

const textField = (identifier: string): Field => ({ identifier, type: "str" });

const PLACEHOLDER_INPUTS = [textField("input")];

/** The workflow's entry inputs and end outputs, read as text the way main's drawer read them. */
function workflowFields(dsl: unknown): { inputs: Field[]; outputs: Field[] } {
  const parsed = studioWorkflowSchema.safeParse(dsl);
  if (!parsed.success) return { inputs: [], outputs: [] };
  const { edges, nodes } = parsed.data;
  const end = nodes.find((node) => node.type === "end" || node.id === "end");
  return {
    inputs: getMappingSurfaceInputs(edges, nodes).map(({ identifier }) => textField(identifier)),
    outputs: (end?.data.inputs ?? []).map(({ identifier }) => textField(identifier)),
  };
}

/** What a workflow agent's drawers read when the address opened them: agent and workflow. */
export function useRoutedWorkflowAgent({
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
  const [workflowId] = agentQuery.data ? findLinkedWorkflowIds(agentQuery.data) : [];
  const workflowQuery = agentApi.workflow.getById.useQuery(
    { projectId, workflowId: workflowId ?? "" },
    { enabled: Boolean(workflowId && projectId) },
  );
  const update = agentApi.agents.update.useMutation();
  const { inputs, outputs } = workflowFields(workflowQuery.data?.currentVersion?.dsl);

  const options: UiWorkflowAgentEditorOptions = {
    open: true,
    ...(agentQuery.data ? { agent: agentQuery.data } : {}),
    isLoading: agentQuery.isLoading || (Boolean(workflowId) && workflowQuery.isLoading),
    isSaving: update.isPending,
    workflowInputs: inputs,
    workflowOutputs: outputs,
    defaultMappings: computeBestMatchMappings({
      inputs: inputs.length > 0 ? inputs : PLACEHOLDER_INPUTS,
    }),
    onUpdate: (input) => {
      void update.mutateAsync({ ...input, projectId }).then(
        async (agent) => {
          await utils.agents.getAll.invalidate({ projectId });
          onSave?.(agent);
          close();
        },
        (error: unknown) =>
          host.failed({ error, fallbackTitle: "Couldn't save the workflow agent" }),
      );
    },
    onClose: close,
  };
  const hasLookupFailed =
    agentQuery.isError || workflowQuery.isError || (Boolean(agentQuery.data) && !workflowId);
  return { options, hasLookupFailed };
}

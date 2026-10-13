import { findLinkedWorkflowIds, type Field } from "@langwatch/agent-contract";
import { computeBestMatchMappings } from "@langwatch/scenario-contract";
import { getMappingSurfaceInputs, studioWorkflowSchema } from "@langwatch/workflow-contract";

import type { AgentBrowser } from "../model/agent-client.ts";
import { useAgentManagementHost } from "../model/agent-management-host.ts";
import { agentApi } from "./agent-api.ts";
import type { WorkflowAgentEditorOptions } from "./use-workflow-agent-editor.ts";

const textField = (identifier: string): Field => ({ identifier, type: "str" });

const PLACEHOLDER_INPUTS = [textField("input")];

/**
 * The workflow's entry inputs and end outputs, read as text the way main's editor drawer read
 * them, plus the inputs with their declared types the way main's target drawer showed them.
 */
function workflowFields(dsl: unknown): { inputs: Field[]; outputs: Field[]; typedInputs: Field[] } {
  const parsed = studioWorkflowSchema.safeParse(dsl);
  if (!parsed.success) return { inputs: [], outputs: [], typedInputs: [] };
  const { edges, nodes } = parsed.data;
  const end = nodes.find((node) => node.type === "end" || node.id === "end");
  const surface = getMappingSurfaceInputs(edges, nodes);
  return {
    inputs: surface.map(({ identifier }) => textField(identifier)),
    outputs: (end?.data.inputs ?? []).map(({ identifier }) => textField(identifier)),
    typedInputs: surface.map(({ identifier, type }) => ({ identifier, type })),
  };
}

/** The workflow's inputs as a target maps them: one text "input" when it declares none. */
function targetInputsOf({
  hasLookupFailed,
  typedInputs,
}: {
  hasLookupFailed: boolean;
  typedInputs: Field[];
}): Field[] {
  if (hasLookupFailed) return [];
  return typedInputs.length > 0 ? typedInputs : PLACEHOLDER_INPUTS;
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
  const { inputs, outputs, typedInputs } = workflowFields(workflowQuery.data?.currentVersion?.dsl);

  const options: WorkflowAgentEditorOptions = {
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
  const project = host.project();
  return {
    options,
    hasLookupFailed,
    ...(workflowQuery.data ? { workflow: workflowQuery.data } : {}),
    targetInputs: targetInputsOf({ hasLookupFailed, typedInputs }),
    ...(project?.slug && workflowId ? { editorHref: `/${project.slug}/studio/${workflowId}` } : {}),
  };
}

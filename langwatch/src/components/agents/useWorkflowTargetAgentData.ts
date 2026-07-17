import { useMemo } from "react";
import type { Variable } from "~/components/variables";
import { getMappingSurfaceInputs } from "~/optimization_studio/utils/nodeUtils";
import type { Field as DSLField, Workflow } from "~/optimization_studio/types/dsl";
import type { TypedAgent } from "~/server/agents/agent.repository";
import { api } from "~/utils/api";

/**
 * Derives the mapping-surface inputs (identifier + type) from a workflow's
 * entry node, the same extraction AgentWorkflowEditorDrawer uses for
 * scenario mapping.
 */
function extractWorkflowInputs(dsl: Workflow | undefined): Variable[] {
  if (!dsl) return [];
  const rawInputs = getMappingSurfaceInputs(dsl.edges, dsl.nodes);
  return rawInputs.flatMap((i) =>
    typeof i.identifier === "string"
      ? [{ identifier: i.identifier, type: i.type as DSLField["type"] }]
      : [],
  );
}

/**
 * Resolves a workflow-type agent target's linked workflow and its real
 * mapping-surface inputs, for AgentWorkflowTargetEditorDrawer.
 *
 * A failed or still-unresolved lookup must not fall back to the synthetic
 * "input" field — that fallback is only valid once we know for a fact the
 * workflow loaded successfully and genuinely declares zero entry inputs.
 * Otherwise a user could map and save against a field ("input") that may
 * not exist on the real (unloaded) workflow.
 */
export function useWorkflowTargetAgentData({
  agentId,
  projectId,
  projectSlug,
  isOpen,
}: {
  agentId: string | undefined;
  projectId: string | undefined;
  projectSlug: string | undefined;
  isOpen: boolean;
}) {
  const agentQuery = api.agents.getById.useQuery(
    { id: agentId ?? "", projectId: projectId ?? "" },
    { enabled: !!agentId && !!projectId && isOpen },
  );

  const workflowId = useMemo(() => {
    if (!agentQuery.data) return undefined;
    const agent = agentQuery.data as TypedAgent & {
      workflowId?: string | null;
    };
    if (agent.workflowId) return agent.workflowId;
    const config = agent.config as { workflow_id?: string };
    return config.workflow_id;
  }, [agentQuery.data]);

  const workflowQuery = api.workflow.getById.useQuery(
    { projectId: projectId ?? "", workflowId: workflowId ?? "" },
    { enabled: !!workflowId && !!projectId && isOpen },
  );

  const workflowInputs = useMemo(
    () =>
      extractWorkflowInputs(
        workflowQuery.data?.currentVersion?.dsl as Workflow | undefined,
      ),
    [workflowQuery.data],
  );

  const hasLookupFailed =
    (!agentQuery.isLoading && !!agentId && !agentQuery.data) ||
    (!!workflowId && !workflowQuery.isLoading && !workflowQuery.data);

  const variablesForUI: Variable[] = hasLookupFailed
    ? []
    : workflowInputs.length > 0
      ? workflowInputs
      : [{ identifier: "input", type: "str" }];

  const editorHref =
    projectSlug && workflowId ? `/${projectSlug}/studio/${workflowId}` : undefined;

  const isLoading = !!agentId && (agentQuery.isLoading || workflowQuery.isLoading);

  return { workflowQuery, variablesForUI, editorHref, isLoading, hasLookupFailed };
}

import type { AgentBrowser } from "../model/agent-client.ts";
import { useAgentManagementHost } from "../model/agent-management-host.ts";
import type { CreateWorkflowAgentInput } from "../model/workflow/create-workflow-agent-input.ts";
import { blankTemplate } from "../model/workflow/templates/blank.template.ts";
import { agentApi } from "./agent-api.ts";

/** Main's workflow agent: a blank workflow first, then the agent that runs it, then its studio. */
export function useCreateWorkflowAgent({ onSave }: { onSave?: (agent: AgentBrowser) => void }) {
  const host = useAgentManagementHost();
  const project = host.project();
  const utils = agentApi.useUtils();
  const createWorkflow = agentApi.workflow.create.useMutation();
  const createAgent = agentApi.agents.create.useMutation();

  const create = async (input: CreateWorkflowAgentInput) => {
    if (!project) return;
    const name = input.name.trim();
    const created = await createWorkflow.mutateAsync({
      projectId: project.id,
      dsl: { ...blankTemplate, name: input.name, description: input.description, icon: input.icon },
      commitMessage: "Workflow creation for agent",
    });
    const workflowId = created.workflow.id;
    const agent = await createAgent.mutateAsync({
      projectId: project.id,
      name,
      type: "workflow",
      config: { name, isCustom: true, workflow_id: workflowId },
      workflowId,
    });
    await utils.agents.getAll.invalidate({ projectId: project.id });
    onSave?.(agent);
    host.navigate(`/${project.slug}/studio/${workflowId}`);
  };

  return { create, isSaving: createWorkflow.isPending || createAgent.isPending };
}

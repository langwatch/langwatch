import { useState } from "react";
import { agentApi, type AgentBrowser } from "@langwatch/agent-web/agent-client";
import { WorkflowSelectorDrawer as WorkflowSelector } from "@langwatch/agent-web/agent-editors";
import { scenarioApi, useScenarioHost } from "@langwatch/scenario-web/screens/simulations";
import { useDrawer } from "@langwatch/ui-drawer";
import { useRouter } from "@langwatch/ui-host/use-router";
import { EmojiPickerModal } from "@langwatch/workflow-web/surfaces/emoji-picker-modal";
import { getRandomWorkflowIcon } from "@langwatch/workflow-web/surfaces/workflow-icons";
import { blankTemplate } from "@langwatch/workflow-web/surfaces/workflow-templates";

export function WorkflowSelectorDrawer(props: {
  open?: boolean;
  agentName?: string;
  onClose?: () => void;
  onSave?: (agent: AgentBrowser) => void;
}) {
  const project = useScenarioHost().project();
  const drawer = useDrawer();
  const router = useRouter();
  const utils = agentApi.useUtils();
  const close = props.onClose ?? drawer.closeDrawer;
  const [defaultIcon] = useState(getRandomWorkflowIcon);
  const createWorkflow = scenarioApi.workflow.create.useMutation();
  const createAgent = agentApi.agents.create.useMutation({
    onSuccess(agent) {
      void utils.agents.getAll.invalidate({ projectId: project?.id ?? "" });
      props.onSave?.(agent);
    },
  });

  return (
    <WorkflowSelector
      open={props.open ?? drawer.drawerOpen("workflowSelector")}
      agentName={props.agentName}
      defaultIcon={defaultIcon}
      isSaving={createWorkflow.isPending || createAgent.isPending}
      renderIconPicker={(picker) => <EmojiPickerModal {...picker} />}
      onClose={close}
      onGoBack={drawer.canGoBack ? drawer.goBack : void 0}
      onCreate={async (input) => {
        if (!project) return;

        const created = await createWorkflow.mutateAsync({
          projectId: project.id,
          dsl: { ...blankTemplate, ...input },
          commitMessage: "Workflow creation for agent",
        });
        await createAgent.mutateAsync({
          projectId: project.id,
          name: input.name.trim(),
          type: "workflow",
          config: { name: input.name.trim(), isCustom: true, workflow_id: created.workflow.id },
          workflowId: created.workflow.id,
        });

        close();
        void router.push(`/${project.slug}/studio/${created.workflow.id}`);
      }}
    />
  );
}

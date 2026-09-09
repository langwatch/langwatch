import { AgentListDrawer as AgentList } from "@langwatch/agent-web/agent-editors";
import { agentApi, type AgentBrowser } from "@langwatch/agent-web/agent-client";
import { useCallback } from "react";
import { useUiCapabilities } from "@langwatch/ui-host/capabilities";
import { useDrawer } from "@langwatch/ui-drawer";
import { describeError } from "@langwatch/ui-host/errors";

export type AgentListDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  onSelect?: (agent: AgentBrowser) => void;
  onEdit?: (agent: AgentBrowser) => void;
  onCreateNew?: () => void;
};

export function AgentListDrawer(props: AgentListDrawerProps) {
  const { session, feedback } = useUiCapabilities();
  const projectId = session.activeScope().projectId ?? "";
  const { closeDrawer, openDrawer, drawerOpen } = useDrawer();
  const open = props.open ?? drawerOpen("agentList");
  const utils = agentApi.useUtils();
  const agents = agentApi.agents.getAll.useQuery(
    { projectId },
    { enabled: Boolean(projectId && open) },
  );
  const archive = agentApi.agents.delete.useMutation();
  const cascadeArchive = agentApi.agents.cascadeArchive.useMutation();
  const getRelated = useCallback(
    (id: string) => utils.agents.getRelatedEntities.fetch({ id, projectId }),
    [projectId, utils.agents.getRelatedEntities],
  );
  const onError = useCallback(
    (error: unknown) => {
      feedback.failed({ error, fallbackTitle: "Couldn't delete the agent" });
    },
    [feedback],
  );

  return (
    <AgentList
      key={projectId}
      open={open}
      items={agents.data ?? []}
      isLoading={agents.isLoading}
      errorMessage={
        agents.error
          ? describeError({ error: agents.error, fallbackTitle: "Couldn't load agents" })
          : void 0
      }
      onClose={props.onClose ?? closeDrawer}
      onSelect={(agent) => props.onSelect?.(agent)}
      onEdit={(agent) => {
        if (props.onEdit) {
          props.onEdit(agent);
          return;
        }
        let drawer: "agentHttpEditor" | "agentWorkflowEditor" | "agentCodeEditor" =
          "agentCodeEditor";
        if (agent.type === "http") drawer = "agentHttpEditor";
        if (agent.type === "workflow") drawer = "agentWorkflowEditor";
        openDrawer(drawer, { agentId: agent.id });
      }}
      onCreateNew={props.onCreateNew ?? (() => openDrawer("agentTypeSelector"))}
      onGetRelated={getRelated}
      onDelete={async (id) => {
        await archive.mutateAsync({ id, projectId });
      }}
      onCascadeArchive={(id) => cascadeArchive.mutateAsync({ id, projectId })}
      onArchived={(workflowArchived) => {
        void utils.agents.getAll.invalidate({ projectId });
        feedback.succeeded({
          title: "Agent deleted",
          description: workflowArchived ? "Also deleted: 1 workflow" : void 0,
        });
      }}
      onError={onError}
    />
  );
}

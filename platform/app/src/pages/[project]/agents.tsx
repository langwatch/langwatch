import { Grid, Skeleton, Spacer, VStack } from "@chakra-ui/react";
import { Plus } from "lucide-react";
import { useCallback, useState } from "react";
import { AgentCard } from "~/components/agents/AgentCard";
import { CopyAgentDialog } from "~/components/agents/CopyAgentDialog";
import { ConnectAgentPanel } from "~/components/agents/connected/ConnectAgentPanel";
import { ConnectedAgentsSection } from "~/components/agents/connected/ConnectedAgentsSection";
import type { ConnectedAgentView } from "~/components/agents/connected/connected-agent-rows";
import { getAgentEditorDrawer } from "~/components/agents/getAgentEditorDrawer";
import { PushToCopiesDialog } from "~/components/agents/PushToCopiesDialog";
import { CascadeArchiveDialog } from "~/components/CascadeArchiveDialog";
import { DashboardLayout } from "~/components/DashboardLayout";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { toaster } from "~/components/ui/toaster";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { showErrorToast } from "~/features/errors";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { TypedAgent } from "~/server/agents/agent.repository";
import { api } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";

/** How often the page reads presence again, in milliseconds. */
const PRESENCE_REFRESH_MS = 5000;

/**
 * Agents management page
 * Single Responsibility: Route and permission handling for agents
 *
 * This is a hidden page for managing database-backed agents.
 * Note: Prompt-based agents are no longer supported - use the Prompts page instead.
 */
function Page() {
  const { project } = useOrganizationTeamProject();
  const { openDrawer } = useDrawer();
  const utils = api.useUtils();
  const router = useRouter();

  // State for tracking which agent is being deleted
  const [agentToDelete, setAgentToDelete] = useState<TypedAgent | null>(null);

  // State for replicate / push dialogs
  const [agentForCopy, setAgentForCopy] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [agentForPush, setAgentForPush] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const syncFromSource = api.agents.syncFromSource.useMutation({
    onSuccess: (_, variables) => {
      void utils.agents.getAll.invalidate({
        projectId: variables.projectId,
      });
      toaster.create({
        title: "Agent updated",
        description: "Agent has been updated from source.",
        type: "success",
      });
    },
    onError: (error) =>
      showErrorToast({
        error,
        fallbackTitle: "Couldn't update agent from source",
      }),
  });

  const handleSyncFromSource = useCallback(
    (agentId: string) => {
      if (!project?.id) return;
      syncFromSource.mutate({ projectId: project.id, agentId });
    },
    [project?.id, syncFromSource],
  );

  // Presence dies with the process that holds it, so the list is read again
  // on a short clock: an agent that connects now appears without a reload.
  const agentsQuery = api.agents.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project, refetchInterval: PRESENCE_REFRESH_MS },
  );

  // Query related entities when delete dialog is open
  const relatedEntitiesQuery = api.agents.getRelatedEntities.useQuery(
    { id: agentToDelete?.id ?? "", projectId: project?.id ?? "" },
    { enabled: !!agentToDelete && !!project?.id },
  );

  const deleteMutation = api.agents.delete.useMutation({
    onSuccess: () => {
      void utils.agents.getAll.invalidate({ projectId: project?.id ?? "" });
      void utils.licenseEnforcement.checkLimit.invalidate();
    },
  });

  const cascadeArchiveMutation = api.agents.cascadeArchive.useMutation({
    onSuccess: (result) => {
      setAgentToDelete(null);
      void utils.agents.getAll.invalidate({ projectId: project?.id ?? "" });
      void utils.licenseEnforcement.checkLimit.invalidate();

      toaster.create({
        title: `Agent deleted`,
        description: result.archivedWorkflow
          ? "Also deleted: 1 workflow"
          : undefined,
        type: "success",
      });
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't delete agent" }),
  });

  const handleEditAgent = (agent: TypedAgent) => {
    openDrawer(getAgentEditorDrawer(agent.type), {
      urlParams: { agentId: agent.id },
    });
  };

  const handleDeleteAgent = (agent: TypedAgent) => {
    setAgentToDelete(agent);
  };

  const confirmDeleteAgent = () => {
    if (!agentToDelete || !project) return;

    const hasRelated = !!relatedEntitiesQuery.data?.workflow;

    if (hasRelated) {
      cascadeArchiveMutation.mutate({
        id: agentToDelete.id,
        projectId: project.id,
      });
    } else {
      deleteMutation.mutate(
        {
          id: agentToDelete.id,
          projectId: project.id,
        },
        {
          onSuccess: () => {
            setAgentToDelete(null);
            toaster.create({
              title: "Agent deleted",
              type: "success",
            });
          },
          onError: (error) =>
            showErrorToast({ error, fallbackTitle: "Couldn't delete agent" }),
        },
      );
    }
  };

  const handleOpenWorkflow = (agent: TypedAgent) => {
    if (agent.workflowId && project?.slug) {
      void router.push(`/${project.slug}/studio/${agent.workflowId}`);
    }
  };

  const connectedAgents = (agentsQuery.data ?? []).filter(
    (agent) => agent.type === "connected",
  ) as unknown as ConnectedAgentView[];
  const otherAgents = (agentsQuery.data ?? []).filter(
    (agent) => agent.type !== "connected",
  );
  const hasAgents = connectedAgents.length + otherAgents.length > 0;

  return (
    <DashboardLayout>
      <PageLayout.Header>
        <PageLayout.Heading>Agents</PageLayout.Heading>
        <Spacer />
        <PageLayout.HeaderButton
          onClick={() => openDrawer("agentTypeSelector")}
        >
          <Plus size={16} /> New Agent
        </PageLayout.HeaderButton>
      </PageLayout.Header>

      <VStack gap={6} width="full" align="stretch" padding={6}>
        {connectedAgents.length === 0 && !agentsQuery.isLoading && (
          <ConnectAgentPanel
            onCreateOtherAgent={() => openDrawer("agentTypeSelector")}
          />
        )}

        {!hasAgents && !agentsQuery.isLoading ? null : (
          <Grid
            templateColumns="repeat(auto-fill, minmax(300px, 1fr))"
            gap={4}
            width="full"
          >
            {agentsQuery.isLoading &&
              Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} height="142px" borderRadius="md" />
              ))}
            <ConnectedAgentsSection
              agents={connectedAgents}
              onOpen={(agent) =>
                openDrawer("agentConnectedDetail", {
                  urlParams: { agentId: agent.id },
                })
              }
              onDelete={(agent) =>
                setAgentToDelete(
                  agentsQuery.data?.find((row) => row.id === agent.id) ?? null,
                )
              }
            />
            {otherAgents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                onClick={() => handleEditAgent(agent)}
                onEdit={() => handleEditAgent(agent)}
                onDelete={() => handleDeleteAgent(agent)}
                onOpenWorkflow={
                  agent.type === "workflow"
                    ? () => handleOpenWorkflow(agent)
                    : undefined
                }
                onReplicate={() =>
                  setAgentForCopy({ id: agent.id, name: agent.name })
                }
                onPushToCopies={() =>
                  setAgentForPush({ id: agent.id, name: agent.name })
                }
                onSyncFromSource={() => handleSyncFromSource(agent.id)}
                onViewHistory={() =>
                  openDrawer("agentHistory", {
                    urlParams: { agentId: agent.id, agentName: agent.name },
                  })
                }
              />
            ))}
          </Grid>
        )}
      </VStack>

      {/* Drawers are rendered by CurrentDrawer in DashboardLayout */}

      <CascadeArchiveDialog
        open={!!agentToDelete}
        onClose={() => setAgentToDelete(null)}
        onConfirm={confirmDeleteAgent}
        isLoading={cascadeArchiveMutation.isPending || deleteMutation.isPending}
        isLoadingRelated={relatedEntitiesQuery.isLoading}
        entityType="agent"
        entityName={agentToDelete?.name ?? ""}
        relatedEntities={{
          workflows: relatedEntitiesQuery.data?.workflow
            ? [relatedEntitiesQuery.data.workflow]
            : [],
        }}
      />

      <CopyAgentDialog
        open={!!agentForCopy}
        onClose={() => setAgentForCopy(null)}
        onSuccess={() =>
          void utils.agents.getAll.invalidate({
            projectId: project?.id ?? "",
          })
        }
        agentId={agentForCopy?.id ?? ""}
        agentName={agentForCopy?.name ?? ""}
      />

      <PushToCopiesDialog
        open={!!agentForPush}
        onClose={() => setAgentForPush(null)}
        agentId={agentForPush?.id ?? ""}
        agentName={agentForPush?.name ?? ""}
      />
    </DashboardLayout>
  );
}

export default withPermissionGuard("evaluations:view", {
  layoutComponent: DashboardLayout,
})(Page);

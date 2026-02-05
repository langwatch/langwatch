import {
  Center,
  EmptyState,
  Grid,
  Skeleton,
  Spacer,
  VStack,
} from "@chakra-ui/react";
import { Bot, Plus } from "lucide-react";
import { useRouter } from "next/router";
import { useCallback, useState } from "react";
import { AgentCard } from "~/components/agents/AgentCard";
import { CopyAgentDialog } from "~/components/agents/CopyAgentDialog";
import { PushToCopiesDialog } from "~/components/agents/PushToCopiesDialog";
import { CascadeArchiveDialog } from "~/components/CascadeArchiveDialog";
import { DashboardLayout } from "~/components/DashboardLayout";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { toaster } from "~/components/ui/toaster";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { TypedAgent } from "~/server/agents/agent.repository";
import { api } from "~/utils/api";

/**
 * Agents management page
 * Single Responsibility: Route and permission handling for agents
 *
 * This is a hidden page for managing database-backed agents.
 * Note: Prompt-based agents are no longer supported - use the Prompts page instead.
 */
function Page() {
  const { project, hasPermission } = useOrganizationTeamProject();
  const { openDrawer } = useDrawer();
  const utils = api.useContext();
  const router = useRouter();

  const hasEvaluationsManagePermission = hasPermission("evaluations:manage");

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
        meta: { closable: true },
      });
    },
    onError: (error) => {
      toaster.create({
        title: "Error updating agent",
        description: error.message ?? "Please try again later.",
        type: "error",
      });
    },
  });

  const handleSyncFromSource = useCallback(
    (agentId: string) => {
      if (!project?.id) return;
      syncFromSource.mutate({ projectId: project.id, agentId });
    },
    [project?.id, syncFromSource],
  );

  const agentsQuery = api.agents.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project },
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
        meta: { closable: true },
      });
    },
    onError: () => {
      toaster.create({
        title: "Error deleting agent",
        description: "Please try again later.",
        type: "error",
      });
    },
  });

  const handleEditAgent = (agent: TypedAgent) => {
    // Open the appropriate editor based on agent type
    switch (agent.type) {
      case "code":
        openDrawer("agentCodeEditor", { urlParams: { agentId: agent.id } });
        break;
      case "http":
        openDrawer("agentHttpEditor", { urlParams: { agentId: agent.id } });
        break;
      case "workflow":
        // Workflow agents can't be edited directly, just view
        openDrawer("workflowSelector", { urlParams: { agentId: agent.id } });
        break;
      default: {
        throw new Error(`Unhandled agent type: ${agent.type}`);
      }
    }
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
              meta: { closable: true },
            });
          },
          onError: () => {
            toaster.create({
              title: "Error deleting agent",
              description: "Please try again later.",
              type: "error",
            });
          },
        },
      );
    }
  };

  const handleOpenWorkflow = (agent: TypedAgent) => {
    if (agent.workflowId && project?.slug) {
      void router.push(`/${project.slug}/studio/${agent.workflowId}`);
    }
  };

  const hasAgents = agentsQuery.data && agentsQuery.data.length > 0;
  const showEmptyState = !agentsQuery.isLoading && !hasAgents;

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

      {showEmptyState ? (
        <Center flex={1} padding={6}>
          <EmptyState.Root>
            <EmptyState.Content>
              <EmptyState.Indicator>
                <Bot size={32} />
              </EmptyState.Indicator>
              <EmptyState.Title>No agents yet</EmptyState.Title>
              <EmptyState.Description>
                Create reusable agents for your evaluations.
              </EmptyState.Description>
              <PageLayout.HeaderButton
                onClick={() => openDrawer("agentTypeSelector")}
              >
                <Plus size={16} /> Create your first agent
              </PageLayout.HeaderButton>
            </EmptyState.Content>
          </EmptyState.Root>
        </Center>
      ) : (
        <VStack gap={6} width="full" align="start" padding={6}>
          <Grid
            templateColumns="repeat(auto-fill, minmax(300px, 1fr))"
            gap={4}
            width="full"
          >
            {agentsQuery.isLoading &&
              Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} height="100px" borderRadius="md" />
              ))}
            {agentsQuery.data?.map((agent) => (
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
                hasEvaluationsManagePermission={hasEvaluationsManagePermission}
              />
            ))}
          </Grid>
        </VStack>
      )}

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

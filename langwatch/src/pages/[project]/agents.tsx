import {
  Center,
  EmptyState,
  Grid,
  Skeleton,
  Spacer,
  VStack,
} from "@chakra-ui/react";
import { Bot, Plus } from "lucide-react";
import { DashboardLayout } from "~/components/DashboardLayout";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { AgentListDrawer } from "~/components/agents/AgentListDrawer";
import { AgentTypeSelectorDrawer } from "~/components/agents/AgentTypeSelectorDrawer";
import { AgentCodeEditorDrawer } from "~/components/agents/AgentCodeEditorDrawer";
import { WorkflowSelectorDrawer } from "~/components/agents/WorkflowSelectorDrawer";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { AgentCard } from "~/components/agents/AgentCard";
import type { TypedAgent } from "~/server/agents/agent.repository";

/**
 * Agents management page
 * Single Responsibility: Route and permission handling for agents
 *
 * This is a hidden page for managing database-backed agents.
 * Note: Prompt-based agents are no longer supported - use the Prompts page instead.
 */
function Page() {
  const { project } = useOrganizationTeamProject();
  const { openDrawer, drawerOpen } = useDrawer();
  const utils = api.useContext();

  const agentsQuery = api.agents.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project },
  );

  const deleteMutation = api.agents.delete.useMutation({
    onSuccess: () => {
      void utils.agents.getAll.invalidate({ projectId: project?.id ?? "" });
    },
  });

  const handleEditAgent = (agent: TypedAgent) => {
    // Open the appropriate editor based on agent type
    switch (agent.type) {
      case "code":
        openDrawer("agentCodeEditor", { urlParams: { agentId: agent.id } });
        break;
      case "workflow":
        // Workflow agents can't be edited directly, just view
        openDrawer("workflowSelector", { urlParams: { agentId: agent.id } });
        break;
    }
  };

  const handleDeleteAgent = (agent: TypedAgent) => {
    if (window.confirm(`Are you sure you want to delete "${agent.name}"?`)) {
      deleteMutation.mutate({
        id: agent.id,
        projectId: project?.id ?? "",
      });
    }
  };

  const hasAgents = agentsQuery.data && agentsQuery.data.length > 0;
  const showEmptyState = !agentsQuery.isLoading && !hasAgents;

  return (
    <DashboardLayout>
      <PageLayout.Header>
        <PageLayout.Heading>Agents</PageLayout.Heading>
        <Spacer />
        <PageLayout.HeaderButton onClick={() => openDrawer("agentTypeSelector")}>
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
              />
            ))}
          </Grid>
        </VStack>
      )}

      {/* Agent management drawers */}
      <AgentListDrawer open={drawerOpen("agentList")} />
      <AgentTypeSelectorDrawer open={drawerOpen("agentTypeSelector")} />
      <AgentCodeEditorDrawer open={drawerOpen("agentCodeEditor")} />
      <WorkflowSelectorDrawer open={drawerOpen("workflowSelector")} />
    </DashboardLayout>
  );
}

export default withPermissionGuard("evaluations:view", {
  layoutComponent: DashboardLayout,
})(Page);

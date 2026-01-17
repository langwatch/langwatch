import {
  Center,
  EmptyState,
  Grid,
  Heading,
  Skeleton,
  Spacer,
  VStack,
} from "@chakra-ui/react";
import { Workflow } from "lucide-react";
import { DashboardLayout } from "../../components/DashboardLayout";
import { PageLayout } from "../../components/ui/layouts/PageLayout";
import { Link } from "../../components/ui/link";
import { withPermissionGuard } from "../../components/WithPermissionGuard";
import { CreateWorkflowButton } from "../../components/workflows/CreateWorkflowButton";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { WorkflowCard } from "../../optimization_studio/components/workflow/WorkflowCard";
import { api } from "../../utils/api";

function Workflows() {
  const { project } = useOrganizationTeamProject();

  const workflows = api.workflow.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project },
  );

  const hasWorkflows = workflows.data && workflows.data.length > 0;
  const showEmptyState = !workflows.isLoading && !hasWorkflows;

  return (
    <DashboardLayout>
      <PageLayout.Header>
        <PageLayout.Heading>Workflows</PageLayout.Heading>
        <Spacer />
        <CreateWorkflowButton />
      </PageLayout.Header>

      {showEmptyState ? (
        <Center flex={1} padding={6}>
          <EmptyState.Root>
            <EmptyState.Content>
              <EmptyState.Indicator>
                <Workflow size={32} />
              </EmptyState.Indicator>
              <EmptyState.Title>No workflows yet</EmptyState.Title>
              <EmptyState.Description>
                Create your first workflow with the Optimization Studio.
              </EmptyState.Description>
              <CreateWorkflowButton
                props={{ colorPalette: "orange", variant: "solid" }}
              />
            </EmptyState.Content>
          </EmptyState.Root>
        </Center>
      ) : (
        <VStack gap={6} width="full" align="start" padding={6}>
          <Grid
            templateColumns="repeat(auto-fill, minmax(260px, 1fr))"
            gap={6}
            width="full"
          >
            {workflows.isLoading &&
              Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} height="200px" />
              ))}
            {workflows.data?.map((workflow) => (
              <Link
                href={`/${project?.slug}/studio/${workflow.id}`}
                key={workflow.id}
                display="block"
                asChild
              >
                <WorkflowCard
                  workflowId={workflow.id}
                  query={workflows}
                  name={workflow.name}
                  icon={workflow.icon}
                  onClick={(e) => {
                    let target = e.target as HTMLElement;
                    while (target.parentElement) {
                      if (target.classList.contains("js-inner-menu")) {
                        e.stopPropagation();
                        e.preventDefault();
                        return false;
                      }
                      target = target.parentElement;
                    }
                  }}
                />
              </Link>
            ))}
          </Grid>
        </VStack>
      )}
    </DashboardLayout>
  );
}

export default withPermissionGuard("workflows:view", {
  layoutComponent: DashboardLayout,
})(Workflows);

import {
  Grid,
  Skeleton,
  Spacer,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import { Plus, Workflow } from "lucide-react";
import { DashboardLayout } from "../../components/DashboardLayout";
import { NoDataInfoBlock } from "../../components/NoDataInfoBlock";
import { PageLayout } from "../../components/ui/layouts/PageLayout";
import { Link } from "../../components/ui/link";
import { withPermissionGuard } from "../../components/WithPermissionGuard";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { WorkflowCard } from "../../optimization_studio/components/workflow/WorkflowCard";
import { NewWorkflowModal } from "../../optimization_studio/components/workflow/NewWorkflowModal";
import { api } from "../../utils/api";

function Workflows() {
  const { project } = useOrganizationTeamProject();
  const { open, onClose, onOpen } = useDisclosure();

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
        <PageLayout.HeaderButton onClick={onOpen}>
          <Plus size={16} /> New Workflow
        </PageLayout.HeaderButton>
      </PageLayout.Header>

      {showEmptyState ? (
        <PageLayout.Container>
          <PageLayout.Content>
            <NoDataInfoBlock
              title="No workflows yet"
              description="Create reusable workflows with the Optimization Studio."
              icon={<Workflow size={24} />}
              color="blue.500"
            >
              <PageLayout.HeaderButton onClick={onOpen} marginTop={4}>
                <Plus size={16} /> Create your first workflow
              </PageLayout.HeaderButton>
            </NoDataInfoBlock>
          </PageLayout.Content>
        </PageLayout.Container>
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

      <NewWorkflowModal open={open} onClose={onClose} />
    </DashboardLayout>
  );
}

export default withPermissionGuard("workflows:view", {
  layoutComponent: DashboardLayout,
})(Workflows);

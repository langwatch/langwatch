import {
  Center,
  EmptyState,
  Grid,
  Skeleton,
  Spacer,
  VStack,
} from "@chakra-ui/react";
import type { Evaluator } from "@prisma/client";
import { CheckSquare, Plus } from "lucide-react";
import { useRouter } from "next/router";
import { DashboardLayout } from "~/components/DashboardLayout";
import { EvaluatorCard } from "~/components/evaluators/EvaluatorCard";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { setFlowCallbacks, useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

/**
 * Evaluators management page
 * Single Responsibility: Route and permission handling for evaluators
 *
 * This is a hidden page for managing database-backed evaluators.
 */
function Page() {
  const { project } = useOrganizationTeamProject();
  const { openDrawer, closeDrawer } = useDrawer();
  const utils = api.useContext();
  const router = useRouter();

  const evaluatorsQuery = api.evaluators.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project },
  );

  const deleteMutation = api.evaluators.delete.useMutation({
    onSuccess: () => {
      void utils.evaluators.getAll.invalidate({ projectId: project?.id ?? "" });
    },
  });

  const handleEditEvaluator = (evaluator: { id: string; config: unknown }) => {
    const config = evaluator.config as { evaluatorType?: string } | null;
    openDrawer("evaluatorEditor", {
      evaluatorId: evaluator.id,
      evaluatorType: config?.evaluatorType,
    });
  };

  const handleCreateNewEvaluator = () => {
    // Set up callback to close drawer after creating new evaluator
    // (instead of going back through category → type → editor stack)
    setFlowCallbacks("evaluatorEditor", {
      onSave: () => {
        closeDrawer();
        return true; // Signal that we handled navigation
      },
    });
    openDrawer("evaluatorCategorySelector");
  };

  const handleDeleteEvaluator = (evaluator: { id: string; name: string }) => {
    if (
      window.confirm(`Are you sure you want to delete "${evaluator.name}"?`)
    ) {
      deleteMutation.mutate({
        id: evaluator.id,
        projectId: project?.id ?? "",
      });
    }
  };

  const handleOpenWorkflow = (evaluator: Evaluator) => {
    if (evaluator.workflowId && project?.slug) {
      void router.push(`/${project.slug}/studio/${evaluator.workflowId}`);
    }
  };

  const hasEvaluators = evaluatorsQuery.data && evaluatorsQuery.data.length > 0;
  const showEmptyState = !evaluatorsQuery.isLoading && !hasEvaluators;

  return (
    <DashboardLayout>
      <PageLayout.Header>
        <PageLayout.Heading>Evaluators</PageLayout.Heading>
        <Spacer />
        <PageLayout.HeaderButton onClick={handleCreateNewEvaluator}>
          <Plus size={16} /> New Evaluator
        </PageLayout.HeaderButton>
      </PageLayout.Header>

      {showEmptyState ? (
        <Center flex={1} padding={6}>
          <EmptyState.Root>
            <EmptyState.Content>
              <EmptyState.Indicator>
                <CheckSquare size={32} />
              </EmptyState.Indicator>
              <EmptyState.Title>No evaluators yet</EmptyState.Title>
              <EmptyState.Description>
                Create reusable evaluators for your evaluations.
              </EmptyState.Description>
              <PageLayout.HeaderButton onClick={handleCreateNewEvaluator}>
                <Plus size={16} /> Create your first evaluator
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
            {evaluatorsQuery.isLoading &&
              Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} height="100px" borderRadius="md" />
              ))}
            {evaluatorsQuery.data?.map((evaluator) => (
              <EvaluatorCard
                key={evaluator.id}
                evaluator={evaluator}
                onClick={() => handleEditEvaluator(evaluator)}
                onEdit={() => handleEditEvaluator(evaluator)}
                onDelete={() => handleDeleteEvaluator(evaluator)}
                onOpenWorkflow={
                  evaluator.type === "workflow"
                    ? () => handleOpenWorkflow(evaluator)
                    : undefined
                }
              />
            ))}
          </Grid>
        </VStack>
      )}
    </DashboardLayout>
  );
}

export default withPermissionGuard("evaluations:view", {
  layoutComponent: DashboardLayout,
})(Page);

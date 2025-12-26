import {
  Center,
  EmptyState,
  Grid,
  Skeleton,
  Spacer,
  VStack,
} from "@chakra-ui/react";
import { CheckSquare, Plus } from "lucide-react";
import { DashboardLayout } from "~/components/DashboardLayout";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { EvaluatorListDrawer } from "~/components/evaluators/EvaluatorListDrawer";
import { EvaluatorCategorySelectorDrawer } from "~/components/evaluators/EvaluatorCategorySelectorDrawer";
import { EvaluatorTypeSelectorDrawer } from "~/components/evaluators/EvaluatorTypeSelectorDrawer";
import { EvaluatorEditorDrawer } from "~/components/evaluators/EvaluatorEditorDrawer";
import { EvaluatorCard } from "~/components/evaluators/EvaluatorCard";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { useDrawer } from "~/hooks/useDrawer";
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
  const { openDrawer, drawerOpen } = useDrawer();

  const evaluatorsQuery = api.evaluators.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project },
  );

  const hasEvaluators = evaluatorsQuery.data && evaluatorsQuery.data.length > 0;
  const showEmptyState = !evaluatorsQuery.isLoading && !hasEvaluators;

  return (
    <DashboardLayout>
      <PageLayout.Header>
        <PageLayout.Heading>Evaluators</PageLayout.Heading>
        <Spacer />
        <PageLayout.HeaderButton onClick={() => openDrawer("evaluatorCategorySelector")}>
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
              <PageLayout.HeaderButton
                onClick={() => openDrawer("evaluatorCategorySelector")}
              >
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
                onClick={() => {
                  // TODO: Open evaluator editor for this evaluator
                }}
              />
            ))}
          </Grid>
        </VStack>
      )}

      {/* Evaluator management drawers */}
      <EvaluatorListDrawer open={drawerOpen("evaluatorList")} />
      <EvaluatorCategorySelectorDrawer open={drawerOpen("evaluatorCategorySelector")} />
      <EvaluatorTypeSelectorDrawer open={drawerOpen("evaluatorTypeSelector")} />
      <EvaluatorEditorDrawer open={drawerOpen("evaluatorEditor")} />
    </DashboardLayout>
  );
}

export default withPermissionGuard("evaluations:view", {
  layoutComponent: DashboardLayout,
})(Page);

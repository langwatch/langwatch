import {
  Center,
  EmptyState,
  Grid,
  Skeleton,
  Spacer,
  VStack,
} from "@chakra-ui/react";
import { CheckSquare, Plus } from "lucide-react";
import { useState } from "react";
import { CascadeArchiveDialog } from "~/components/CascadeArchiveDialog";
import { DashboardLayout } from "~/components/DashboardLayout";
import { EvaluatorCard } from "~/components/evaluators/EvaluatorCard";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { toaster } from "~/components/ui/toaster";
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

  // State for tracking which evaluator is being deleted
  const [evaluatorToDelete, setEvaluatorToDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const evaluatorsQuery = api.evaluators.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project },
  );

  // Query related entities when delete dialog is open
  const relatedEntitiesQuery = api.evaluators.getRelatedEntities.useQuery(
    { id: evaluatorToDelete?.id ?? "", projectId: project?.id ?? "" },
    { enabled: !!evaluatorToDelete && !!project?.id },
  );

  const deleteMutation = api.evaluators.delete.useMutation({
    onSuccess: () => {
      void utils.evaluators.getAll.invalidate({ projectId: project?.id ?? "" });
    },
  });

  const cascadeArchiveMutation = api.evaluators.cascadeArchive.useMutation({
    onSuccess: (result) => {
      setEvaluatorToDelete(null);
      void utils.evaluators.getAll.invalidate({ projectId: project?.id ?? "" });

      const parts: string[] = [];
      if (result.archivedWorkflow) {
        parts.push("1 workflow");
      }
      if (result.deletedMonitorsCount > 0) {
        parts.push(
          `${result.deletedMonitorsCount} online evaluation${result.deletedMonitorsCount > 1 ? "s" : ""}`,
        );
      }

      toaster.create({
        title: `Evaluator deleted`,
        description:
          parts.length > 0 ? `Also deleted: ${parts.join(", ")}` : undefined,
        type: "success",
        meta: { closable: true },
      });
    },
    onError: () => {
      toaster.create({
        title: "Error deleting evaluator",
        description: "Please try again later.",
        type: "error",
      });
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
    setEvaluatorToDelete(evaluator);
  };

  const confirmDeleteEvaluator = () => {
    if (!evaluatorToDelete || !project) return;

    const hasRelated =
      !!relatedEntitiesQuery.data?.workflow ||
      (relatedEntitiesQuery.data?.monitors.length ?? 0) > 0;

    if (hasRelated) {
      cascadeArchiveMutation.mutate({
        id: evaluatorToDelete.id,
        projectId: project.id,
      });
    } else {
      deleteMutation.mutate(
        {
          id: evaluatorToDelete.id,
          projectId: project.id,
        },
        {
          onSuccess: () => {
            setEvaluatorToDelete(null);
            toaster.create({
              title: "Evaluator deleted",
              type: "success",
              meta: { closable: true },
            });
          },
          onError: () => {
            toaster.create({
              title: "Error deleting evaluator",
              description: "Please try again later.",
              type: "error",
            });
          },
        },
      );
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
              />
            ))}
          </Grid>
        </VStack>
      )}

      <CascadeArchiveDialog
        open={!!evaluatorToDelete}
        onClose={() => setEvaluatorToDelete(null)}
        onConfirm={confirmDeleteEvaluator}
        isLoading={cascadeArchiveMutation.isPending || deleteMutation.isPending}
        isLoadingRelated={relatedEntitiesQuery.isLoading}
        entityType="evaluator"
        entityName={evaluatorToDelete?.name ?? ""}
        relatedEntities={{
          workflows: relatedEntitiesQuery.data?.workflow
            ? [relatedEntitiesQuery.data.workflow]
            : [],
          monitors: relatedEntitiesQuery.data?.monitors,
        }}
      />
    </DashboardLayout>
  );
}

export default withPermissionGuard("evaluations:view", {
  layoutComponent: DashboardLayout,
})(Page);

/**
 * `/:project/evaluators` — every reusable scoring function in the project.
 *
 * WHAT THIS SCREEN CAN DO ON ITS OWN: list, delete (with the cascade the delete
 * would cause named first), replicate into another project, push a change onto
 * the replicas, pull a replica back in line with its source, read the audit
 * history, and print the snippets that call an evaluator from a customer's own
 * code.
 *
 * WHAT IT ASKS THE APPLICATION FOR, and does not have today: CREATING and
 * EDITING an evaluator. Both are `platform/app` drawers — `evaluatorEditor`
 * (fifteen openers, fourteen of them outside this family), `codeEvaluatorEditor`
 * (four, three outside) and `evaluatorCategorySelector` (five, four outside) —
 * and a drawer with a caller outside the family does not move. So the screen
 * writes the ADDRESS through `host.openOverlay`, and under `apps/ui` today
 * nothing opens, because the registry is mounted by `DashboardPageBody`, which
 * is chrome a packaged screen has nothing above it to supply. The me,
 * automations, annotations and analytics families recorded the same gap for the
 * same registry.
 *
 * `setFlowCallbacks("evaluatorEditor", …)` DID NOT TRAVEL AND COULD NOT.
 * `platform/app` registered a callback so that saving a NEW evaluator closed the
 * drawer instead of walking back up the category → type → editor stack. That is
 * a registry-wide side channel that exists only because an address carries
 * strings and not functions — the analytics family found the same shape behind
 * `seriesFilters` — and it belongs to whoever owns the drawer.
 */

import { Center, EmptyState, Grid, HStack, Skeleton, Spacer, Text, VStack } from "@chakra-ui/react";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { CheckSquare, Plus } from "lucide-react";
import { useCallback, useState } from "react";

import { evaluatorApi } from "../../behavior/evaluator-api";
import { useEvaluatorHost } from "../../model/evaluator-host";
import { EvaluatorDeleteDialog } from "../../ui/blocks/evaluator-delete-dialog";
import { EvaluatorGridCard } from "../../ui/blocks/evaluator-grid-card";
import { EvaluatorHistoryPanel } from "../../ui/sections/evaluator-history-panel";
import { EvaluatorPushToCopiesDialog } from "../../ui/sections/evaluator-push-to-copies-dialog";
import { EvaluatorReplicateDialog } from "../../ui/sections/evaluator-replicate-dialog";

/** The grant the platform page carried, unchanged. */
export const EVALUATORS_PAGE_PERMISSION = "evaluations:view";

/** The query key the history panel is addressed by. */
const HISTORY_PARAM = "history";

type EvaluatorRef = { id: string; name: string };

export default function EvaluatorsScreen() {
  const host = useEvaluatorHost();
  const { projectId } = host.scope();
  const utils = evaluatorApi.useUtils();

  const [evaluatorToDelete, setEvaluatorToDelete] = useState<EvaluatorRef | null>(null);
  const [evaluatorForCopy, setEvaluatorForCopy] = useState<EvaluatorRef | null>(null);
  const [evaluatorForPush, setEvaluatorForPush] = useState<EvaluatorRef | null>(null);

  const evaluatorsQuery = evaluatorApi.evaluators.getAll.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId },
  );

  const historyId = host.route().query[HISTORY_PARAM];
  const historyEvaluator = evaluatorsQuery.data?.find((evaluator) => evaluator.id === historyId);

  const syncFromSource = evaluatorApi.evaluators.syncFromSource.useMutation({
    onSuccess: (_result, variables) => {
      void utils.evaluators.getAll.invalidate({ projectId: variables.projectId });
      host.succeeded({
        title: "Evaluator updated",
        description: "Evaluator has been updated from source.",
      });
    },
    onError: (error) =>
      host.failed({ error, fallbackTitle: "Couldn't update evaluator from source" }),
  });

  const handleSyncFromSource = useCallback(
    (evaluatorId: string) => {
      if (!projectId) return;
      syncFromSource.mutate({ projectId, evaluatorId });
    },
    [projectId, syncFromSource],
  );

  // Asked only while the confirmation is open: the answer is what the dialog's
  // warning is built from, and asking it per card would fan out with the grid.
  const relatedEntitiesQuery = evaluatorApi.evaluators.getRelatedEntities.useQuery(
    { id: evaluatorToDelete?.id ?? "", projectId: projectId ?? "" },
    { enabled: !!evaluatorToDelete && !!projectId },
  );

  const deleteMutation = evaluatorApi.evaluators.delete.useMutation({
    onSuccess: () => {
      void utils.evaluators.getAll.invalidate({ projectId: projectId ?? "" });
      void utils.licenseEnforcement.checkLimit.invalidate();
    },
  });

  const cascadeArchiveMutation = evaluatorApi.evaluators.cascadeArchive.useMutation({
    onSuccess: (result) => {
      setEvaluatorToDelete(null);
      void utils.evaluators.getAll.invalidate({ projectId: projectId ?? "" });
      void utils.licenseEnforcement.checkLimit.invalidate();

      const parts: string[] = [];
      if (result.archivedWorkflow) parts.push("1 workflow");
      if (result.deletedMonitorsCount > 0) {
        parts.push(
          `${result.deletedMonitorsCount} online evaluation${
            result.deletedMonitorsCount > 1 ? "s" : ""
          }`,
        );
      }

      host.succeeded({
        title: "Evaluator deleted",
        description: parts.length > 0 ? `Also deleted: ${parts.join(", ")}` : undefined,
      });
    },
    onError: (error) => host.failed({ error, fallbackTitle: "Couldn't delete evaluator" }),
  });

  const openEditor = (evaluator: { id: string; type?: string; config: unknown }) => {
    if (evaluator.type === "code") {
      host.openOverlay({
        drawer: "codeEvaluatorEditor",
        params: { evaluatorId: evaluator.id },
      });
      return;
    }
    const config = evaluator.config as { evaluatorType?: string } | null;
    host.openOverlay({
      drawer: "evaluatorEditor",
      params: { evaluatorId: evaluator.id, evaluatorType: config?.evaluatorType },
    });
  };

  const openCreate = () => host.openOverlay({ drawer: "evaluatorCategorySelector" });

  const openHistory = (evaluatorId: string) =>
    host.setQuery({ ...host.route().query, [HISTORY_PARAM]: evaluatorId });

  const closeHistory = () => host.setQuery({ ...host.route().query, [HISTORY_PARAM]: void 0 });

  const confirmDelete = () => {
    if (!evaluatorToDelete || !projectId) return;

    const related = relatedEntitiesQuery.data;
    const hasRelated = !!related?.workflow || (related?.monitors.length ?? 0) > 0;

    if (hasRelated) {
      cascadeArchiveMutation.mutate({ id: evaluatorToDelete.id, projectId });
      return;
    }

    deleteMutation.mutate(
      { id: evaluatorToDelete.id, projectId },
      {
        onSuccess: () => {
          setEvaluatorToDelete(null);
          host.succeeded({ title: "Evaluator deleted" });
        },
        onError: (error) => host.failed({ error, fallbackTitle: "Couldn't delete evaluator" }),
      },
    );
  };

  const hasEvaluators = (evaluatorsQuery.data?.length ?? 0) > 0;
  const showEmptyState = !evaluatorsQuery.isLoading && !hasEvaluators;

  return (
    <>
      <PageLayout.Header>
        <PageLayout.Heading>Evaluators</PageLayout.Heading>
        <Spacer />
        <PageLayout.HeaderButton onClick={openCreate}>
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
                Create reusable scoring functions for experiments, online evaluations, and
                guardrails.
              </EmptyState.Description>
              <HStack gap={2}>
                <PageLayout.HeaderButton onClick={openCreate}>
                  <Plus size={16} /> Create your first evaluator
                </PageLayout.HeaderButton>
              </HStack>
            </EmptyState.Content>
          </EmptyState.Root>
        </Center>
      ) : (
        <VStack gap={6} width="full" align="start" padding={6}>
          <Text color="fg.muted">
            Evaluators are reusable scoring functions for experiments, online evaluations, and
            guardrails.
          </Text>
          <Grid templateColumns="repeat(auto-fill, minmax(300px, 1fr))" gap={4} width="full">
            {evaluatorsQuery.isLoading &&
              Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} height="100px" borderRadius="md" />
              ))}
            {evaluatorsQuery.data?.map((evaluator) => (
              <EvaluatorGridCard
                key={evaluator.id}
                evaluator={evaluator}
                onClick={() => openEditor(evaluator)}
                onEdit={() => openEditor(evaluator)}
                onDelete={() => setEvaluatorToDelete({ id: evaluator.id, name: evaluator.name })}
                onReplicate={() => setEvaluatorForCopy({ id: evaluator.id, name: evaluator.name })}
                onPushToCopies={() =>
                  setEvaluatorForPush({ id: evaluator.id, name: evaluator.name })
                }
                onSyncFromSource={() => handleSyncFromSource(evaluator.id)}
                onViewHistory={() => openHistory(evaluator.id)}
              />
            ))}
          </Grid>
        </VStack>
      )}

      <EvaluatorDeleteDialog
        open={!!evaluatorToDelete}
        onClose={() => setEvaluatorToDelete(null)}
        onConfirm={confirmDelete}
        isLoading={cascadeArchiveMutation.isPending || deleteMutation.isPending}
        isLoadingRelated={relatedEntitiesQuery.isLoading}
        evaluatorName={evaluatorToDelete?.name ?? ""}
        workflow={relatedEntitiesQuery.data?.workflow ?? null}
        monitors={relatedEntitiesQuery.data?.monitors ?? []}
      />

      <EvaluatorReplicateDialog
        open={!!evaluatorForCopy}
        onClose={() => setEvaluatorForCopy(null)}
        onSuccess={() => void utils.evaluators.getAll.invalidate({ projectId: projectId ?? "" })}
        evaluatorId={evaluatorForCopy?.id ?? ""}
        evaluatorName={evaluatorForCopy?.name ?? ""}
      />

      <EvaluatorPushToCopiesDialog
        open={!!evaluatorForPush}
        onClose={() => setEvaluatorForPush(null)}
        evaluatorId={evaluatorForPush?.id ?? ""}
        evaluatorName={evaluatorForPush?.name ?? ""}
      />

      {historyId && (
        <EvaluatorHistoryPanel
          evaluatorId={historyId}
          evaluatorName={historyEvaluator?.name ?? "Evaluator"}
          onClose={closeHistory}
        />
      )}
    </>
  );
}

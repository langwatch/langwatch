import { Button, Heading, HStack, Spinner, VStack } from "@chakra-ui/react";
import { formatDistanceToNow } from "date-fns";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Drawer } from "~/components/ui/drawer";
import {
  COMPARISON_EVALUATOR_TYPE,
  LEGACY_PAIRWISE_EVALUATOR_TYPE,
} from "~/experiments-v3/types";
import { getComplexProps, getFlowCallbacks, useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { EvaluatorWithFields } from "@langwatch/evaluator-contract";
import { EvaluatorListEmptyState, EvaluatorListItem } from "@langwatch/evaluator-web";
import { api } from "~/utils/api";
import { ConfirmDialog } from "../gateway/ConfirmDialog";
import { EvaluatorApiUsageDialog } from "./EvaluatorApiUsageDialog";

export type EvaluatorListDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  onSelect?: (evaluator: EvaluatorWithFields) => void;
  onCreateNew?: () => void;
  filterEvaluatorType?: string;
  title?: string;
  createLabel?: string;
  itemLabel?: string;
};

export function EvaluatorListDrawer(props: EvaluatorListDrawerProps) {
  const { project } = useOrganizationTeamProject();
  const { closeDrawer, openDrawer } = useDrawer();
  const complexProps = getComplexProps();
  const utils = api.useUtils();
  const flowCallbacks = getFlowCallbacks("evaluatorList");

  const onClose = props.onClose ?? closeDrawer;
  const onSelect =
    props.onSelect ??
    flowCallbacks?.onSelect ??
    (complexProps.onSelect as EvaluatorListDrawerProps["onSelect"]);
  const onCreateNew =
    props.onCreateNew ??
    flowCallbacks?.onCreateNew ??
    (complexProps.onCreateNew as EvaluatorListDrawerProps["onCreateNew"]) ??
    (() => openDrawer("evaluatorCategorySelector"));
  const isOpen = props.open !== false && props.open !== undefined;
  const title = props.title ?? "Choose Evaluator";
  const createLabel = props.createLabel ?? "New Evaluator";
  const itemLabel = props.itemLabel ?? "evaluator";

  const evaluatorsQuery = api.evaluators.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id && isOpen },
  );

  const evaluators = props.filterEvaluatorType
    ? evaluatorsQuery.data?.filter(
        (evaluator) =>
          (evaluator.config as { evaluatorType?: string } | null)?.evaluatorType ===
          props.filterEvaluatorType,
      )
    : evaluatorsQuery.data?.filter((evaluator) => {
        const evaluatorType = (evaluator.config as { evaluatorType?: string } | null)
          ?.evaluatorType;
        return (
          evaluatorType !== COMPARISON_EVALUATOR_TYPE &&
          evaluatorType !== LEGACY_PAIRWISE_EVALUATOR_TYPE
        );
      });

  const deleteMutation = api.evaluators.delete.useMutation({
    onSuccess: () => {
      void utils.evaluators.getAll.invalidate({ projectId: project?.id ?? "" });
    },
  });

  const handleSelectEvaluator = (evaluator: EvaluatorWithFields) => {
    onSelect?.(evaluator);
  };

  const handleEditEvaluator = (evaluator: EvaluatorWithFields) => {
    if (evaluator.type === "code") {
      openDrawer("codeEvaluatorEditor", { evaluatorId: evaluator.id });
      return;
    }
    const config = evaluator.config as { evaluatorType?: string } | null;
    openDrawer("evaluatorEditor", {
      evaluatorId: evaluator.id,
      evaluatorType: config?.evaluatorType,
    });
  };

  const [apiDialogEvaluator, setApiDialogEvaluator] =
    useState<EvaluatorWithFields | null>(null);
  const [evaluatorToDelete, setEvaluatorToDelete] = useState<EvaluatorWithFields | null>(
    null,
  );

  return (
    <Drawer.Root
      open={isOpen}
      onOpenChange={({ open }) => !open && onClose()}
      size="md"
      modal={false}
    >
      <Drawer.Content bg="bg">
        <Drawer.CloseTrigger />
        <Drawer.Header>
          <HStack gap={2} justify="space-between" width="full">
            <Heading>{title}</Heading>
            <Button
              size="sm"
              colorScheme="blue"
              onClick={onCreateNew}
              data-testid="new-evaluator-button"
            >
              <Plus size={16} />
              {createLabel}
            </Button>
          </HStack>
        </Drawer.Header>
        <Drawer.Body display="flex" flexDirection="column" overflow="hidden" padding={0}>
          <VStack gap={4} align="stretch" flex={1} overflow="hidden">
            <VStack
              gap={2}
              align="stretch"
              flex={1}
              overflowY="auto"
              paddingX={6}
              paddingBottom={4}
            >
              {evaluatorsQuery.isLoading ? (
                <HStack justify="center" paddingY={8}>
                  <Spinner size="md" />
                </HStack>
              ) : evaluators?.length === 0 ? (
                <EvaluatorListEmptyState
                  onCreateNew={onCreateNew}
                  itemLabel={itemLabel}
                />
              ) : (
                evaluators?.map((evaluator) => (
                  <EvaluatorListItem
                    key={evaluator.id}
                    evaluator={evaluator}
                    updatedAtLabel={formatDistanceToNow(new Date(evaluator.updatedAt), {
                      addSuffix: true,
                    })}
                    onClick={() => handleSelectEvaluator(evaluator)}
                    onEdit={() => handleEditEvaluator(evaluator)}
                    onDelete={() => setEvaluatorToDelete(evaluator)}
                    onUseFromApi={() => setApiDialogEvaluator(evaluator)}
                  />
                ))
              )}
            </VStack>
          </VStack>
        </Drawer.Body>
        <Drawer.Footer borderTopWidth="1px" borderColor="border">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </Drawer.Footer>
      </Drawer.Content>

      <EvaluatorApiUsageDialog
        evaluator={apiDialogEvaluator}
        open={!!apiDialogEvaluator}
        onClose={() => setApiDialogEvaluator(null)}
      />

      <ConfirmDialog
        open={!!evaluatorToDelete}
        onOpenChange={(open) => {
          if (!open) setEvaluatorToDelete(null);
        }}
        title="Delete evaluator"
        message={`Are you sure you want to delete "${evaluatorToDelete?.name ?? ""}"?`}
        confirmLabel="Delete"
        tone="danger"
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (!evaluatorToDelete) return;
          deleteMutation.mutate(
            { id: evaluatorToDelete.id, projectId: project?.id ?? "" },
            { onSettled: () => setEvaluatorToDelete(null) },
          );
        }}
      />
    </Drawer.Root>
  );
}

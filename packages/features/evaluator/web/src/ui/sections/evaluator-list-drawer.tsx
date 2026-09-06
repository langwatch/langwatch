/**
 * "Choose Evaluator": the picker every flow opens, a REGISTERED drawer
 * belonging to the family that owns evaluators. KNOWN GAP: "New
 * Evaluator"/"Edit" still open drawers in `platform/app`.
 */

import { Button, Heading, HStack, Spinner, VStack } from "@chakra-ui/react";
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import type { Evaluator } from "@langwatch/evaluator-contract";
import { Drawer } from "@langwatch/design-system/drawer";
import {
  COMPARISON_EVALUATOR_TYPE,
  LEGACY_PAIRWISE_EVALUATOR_TYPE,
} from "@langwatch/experiment-web/surfaces/workbench-types";
import { getComplexProps, getFlowCallbacks, useDrawer } from "@langwatch/ui-drawer";
import { formatDistanceToNow } from "@langwatch/time";
import { Plus } from "lucide-react";
import { useState } from "react";

import { evaluatorApi } from "../../behavior/evaluator-api";
import { useEvaluatorHost } from "../../model/evaluator-host";
import { EvaluatorApiUsageDialog } from "../blocks/evaluator-api-usage-dialog";
import { EvaluatorListItem } from "../blocks/evaluator-list-item";
import { EvaluatorListEmptyState } from "../elements/evaluator-list-empty-state";

/**
 * One row of the picker, as this package's own transport map answers it:
 * the contract's `Evaluator`, wide enough since the list never reads an
 * evaluator's fields — not the router-inferred type this package can't see.
 */
export type EvaluatorListRow = Evaluator;

export type EvaluatorListDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  onSelect?: (evaluator: EvaluatorListRow) => void;
  onCreateNew?: () => void;
  filterEvaluatorType?: string;
  title?: string;
  createLabel?: string;
  itemLabel?: string;
};

export function EvaluatorListDrawer(props: EvaluatorListDrawerProps) {
  const host = useEvaluatorHost();
  const projectId = host.scope().projectId;
  const { closeDrawer, openDrawer } = useDrawer();
  const complexProps = getComplexProps();
  const utils = evaluatorApi.useUtils();
  const flowCallbacks = getFlowCallbacks("evaluatorList");

  const onClose = props.onClose ?? closeDrawer;
  const onSelect =
    props.onSelect ??
    (flowCallbacks?.onSelect as EvaluatorListDrawerProps["onSelect"]) ??
    (complexProps.onSelect as EvaluatorListDrawerProps["onSelect"]);
  const onCreateNew =
    props.onCreateNew ??
    (flowCallbacks?.onCreateNew as EvaluatorListDrawerProps["onCreateNew"]) ??
    (complexProps.onCreateNew as EvaluatorListDrawerProps["onCreateNew"]) ??
    (() => openDrawer("evaluatorCategorySelector"));
  // `props.open` arrives from the address as the drawer NAME, not a boolean.
  const isOpen = props.open !== false && props.open !== undefined;
  const title = props.title ?? "Choose Evaluator";
  const createLabel = props.createLabel ?? "New Evaluator";
  const itemLabel = props.itemLabel ?? "evaluator";

  const evaluatorsQuery = evaluatorApi.evaluators.getAll.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId && isOpen },
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

  const deleteMutation = evaluatorApi.evaluators.delete.useMutation({
    onSuccess: () => {
      void utils.evaluators.getAll.invalidate({ projectId: projectId ?? "" });
    },
  });

  const handleEditEvaluator = (evaluator: EvaluatorListRow) => {
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

  const [apiDialogEvaluator, setApiDialogEvaluator] = useState<EvaluatorListRow | null>(null);
  const [evaluatorToDelete, setEvaluatorToDelete] = useState<EvaluatorListRow | null>(null);

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
                <EvaluatorListEmptyState onCreateNew={onCreateNew} itemLabel={itemLabel} />
              ) : (
                evaluators?.map((evaluator) => (
                  <EvaluatorListItem
                    key={evaluator.id}
                    evaluator={evaluator}
                    updatedAtLabel={formatDistanceToNow(new Date(evaluator.updatedAt), {
                      addSuffix: true,
                    })}
                    onClick={() => onSelect?.(evaluator)}
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
            { id: evaluatorToDelete.id, projectId: projectId ?? "" },
            { onSettled: () => setEvaluatorToDelete(null) },
          );
        }}
      />
    </Drawer.Root>
  );
}

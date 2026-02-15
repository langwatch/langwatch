import {
  Box,
  Button,
  Heading,
  HStack,
  IconButton,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { EvaluatorWithFields } from "~/server/evaluators/evaluator.service";
import { formatDistanceToNow } from "date-fns";
import { CheckCircle, Code, Plus, Workflow } from "lucide-react";
import { useState } from "react";
import { LuEllipsisVertical, LuPencil, LuTrash2 } from "react-icons/lu";
import { Drawer } from "~/components/ui/drawer";
import {
  getComplexProps,
  getFlowCallbacks,
  useDrawer,
} from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import {
  AVAILABLE_EVALUATORS,
  type EvaluatorTypes,
} from "~/server/evaluations/evaluators.generated";
import { api } from "~/utils/api";
import { evaluatorTempNameMap } from "../checks/EvaluatorSelection";
import { Menu } from "../ui/menu";
import { EvaluatorApiUsageDialog } from "./EvaluatorApiUsageDialog";

export type EvaluatorListDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  onSelect?: (evaluator: EvaluatorWithFields) => void;
  onCreateNew?: () => void;
};

/**
 * Drawer for selecting an existing evaluator or creating a new one.
 * Features:
 * - Shows list of saved evaluators
 * - Empty state with create CTA
 * - "New Evaluator" button at top
 * - Reusable across the app via useDrawer
 */
export function EvaluatorListDrawer(props: EvaluatorListDrawerProps) {
  const { project } = useOrganizationTeamProject();
  const { closeDrawer, openDrawer } = useDrawer();
  const complexProps = getComplexProps();
  const utils = api.useContext();

  // Get flow callbacks for this drawer (set by parent drawer like OnlineEvaluationDrawer)
  const flowCallbacks = getFlowCallbacks("evaluatorList");

  const onClose = props.onClose ?? closeDrawer;
  const onSelect =
    props.onSelect ??
    flowCallbacks?.onSelect ??
    (complexProps.onSelect as EvaluatorListDrawerProps["onSelect"]);
  const onCreateNew =
    props.onCreateNew ??
    flowCallbacks?.onCreateNew ??
    (() => openDrawer("evaluatorCategorySelector"));
  const isOpen = props.open !== false && props.open !== undefined;

  const evaluatorsQuery = api.evaluators.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id && isOpen },
  );

  const deleteMutation = api.evaluators.delete.useMutation({
    onSuccess: () => {
      void utils.evaluators.getAll.invalidate({ projectId: project?.id ?? "" });
    },
  });

  const handleSelectEvaluator = (evaluator: EvaluatorWithFields) => {
    // IMPORTANT: Only call the callback - do NOT navigate here!
    // Navigation (goBack/closeDrawer) is the CALLER'S responsibility.
    // Different callers have different navigation needs:
    // - OnlineEvaluationDrawer: opens evaluatorEditor with mappings config (no goBack here)
    // - EvaluationsV3: adds to workbench and closes drawer (caller calls closeDrawer)
    // - Other flows: may have different requirements
    // If you add goBack() here, you WILL break existing flows.
    onSelect?.(evaluator);
  };

  const handleEditEvaluator = (evaluator: EvaluatorWithFields) => {
    const config = evaluator.config as { evaluatorType?: string } | null;
    openDrawer("evaluatorEditor", {
      evaluatorId: evaluator.id,
      evaluatorType: config?.evaluatorType,
    });
  };

  const handleDeleteEvaluator = (evaluator: EvaluatorWithFields) => {
    if (
      window.confirm(`Are you sure you want to delete "${evaluator.name}"?`)
    ) {
      deleteMutation.mutate({
        id: evaluator.id,
        projectId: project?.id ?? "",
      });
    }
  };

  // State for API usage dialog
  const [apiDialogEvaluator, setApiDialogEvaluator] =
    useState<EvaluatorWithFields | null>(null);

  const handleUseFromApi = (evaluator: EvaluatorWithFields) => {
    setApiDialogEvaluator(evaluator);
  };

  return (
    <Drawer.Root
      open={isOpen}
      onOpenChange={({ open }) => !open && onClose()}
      size="md"
      closeOnInteractOutside={false}
      modal={false}
    >
      <Drawer.Content>
        <Drawer.CloseTrigger />
        <Drawer.Header>
          <HStack gap={2} justify="space-between" width="full">
            <Heading>Choose Evaluator</Heading>
            <Button
              size="sm"
              colorScheme="blue"
              onClick={onCreateNew}
              data-testid="new-evaluator-button"
            >
              <Plus size={16} />
              New Evaluator
            </Button>
          </HStack>
        </Drawer.Header>
        <Drawer.Body
          display="flex"
          flexDirection="column"
          overflow="hidden"
          padding={0}
        >
          <VStack gap={4} align="stretch" flex={1} overflow="hidden">
            {/* Evaluator list - scrollable */}
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
              ) : evaluatorsQuery.data?.length === 0 ? (
                <EmptyState onCreateNew={onCreateNew} />
              ) : (
                evaluatorsQuery.data?.map((evaluator) => (
                  <EvaluatorCard
                    key={evaluator.id}
                    evaluator={evaluator}
                    onClick={() => handleSelectEvaluator(evaluator)}
                    onEdit={() => handleEditEvaluator(evaluator)}
                    onDelete={() => handleDeleteEvaluator(evaluator)}
                    onUseFromApi={() => handleUseFromApi(evaluator)}
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

      {/* API Usage Dialog */}
      <EvaluatorApiUsageDialog
        evaluator={apiDialogEvaluator}
        open={!!apiDialogEvaluator}
        onClose={() => setApiDialogEvaluator(null)}
      />
    </Drawer.Root>
  );
}

// ============================================================================
// Empty State Component
// ============================================================================

function EmptyState({ onCreateNew }: { onCreateNew: () => void }) {
  return (
    <VStack paddingY={24} gap={4} textAlign="center">
      <Box padding={4} borderRadius="full" bg="green.subtle" color="green.fg">
        <CheckCircle size={32} />
      </Box>
      <VStack gap={1}>
        <Text fontWeight="medium" color="fg">
          No evaluators yet
        </Text>
        <Text fontSize="sm" color="fg.muted">
          Create your first evaluator to get started
        </Text>
      </VStack>
      <Button
        colorScheme="blue"
        onClick={onCreateNew}
        data-testid="create-first-evaluator-button"
      >
        <Plus size={16} />
        Create your first evaluator
      </Button>
    </VStack>
  );
}

// ============================================================================
// Evaluator Card Component
// ============================================================================

type EvaluatorCardProps = {
  evaluator: EvaluatorWithFields;
  onClick: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onUseFromApi: () => void;
};

const getEvaluatorDisplayName = (evaluatorType: string): string => {
  if (!evaluatorType) return "";

  const evaluatorDefinition =
    AVAILABLE_EVALUATORS[evaluatorType as EvaluatorTypes];
  if (!evaluatorDefinition) return evaluatorType;

  return (
    evaluatorTempNameMap[evaluatorDefinition.name] ?? evaluatorDefinition.name
  );
};

function EvaluatorCard({
  evaluator,
  onClick,
  onEdit,
  onDelete,
  onUseFromApi,
}: EvaluatorCardProps) {
  const config = evaluator.config as { evaluatorType?: string } | null;
  const evaluatorType = config?.evaluatorType ?? "";
  const displayName =
    evaluator.type === "workflow"
      ? "Workflow"
      : getEvaluatorDisplayName(evaluatorType);

  return (
    <Box
      as="button"
      onClick={onClick}
      padding={4}
      borderRadius="md"
      border="1px solid"
      borderColor="border"
      bg="bg.panel"
      textAlign="left"
      width="full"
      _hover={{ borderColor: "green.muted", bg: "green.subtle" }}
      transition="all 0.15s"
      data-testid={`evaluator-card-${evaluator.id}`}
      position="relative"
    >
      <HStack gap={3} align="start">
        <Box color="green.fg" paddingTop={1}>
          {evaluator.type === "workflow" ? (
            <Workflow size={16} />
          ) : (
            <CheckCircle size={16} />
          )}
        </Box>
        <VStack align="start" gap={0} flex={1}>
          <Text fontWeight="medium" fontSize="13px">
            {evaluator.name}
          </Text>
          <Text fontSize="xs" color="fg.muted" lineClamp={1}>
            {displayName && (
              <>
                <span>{displayName}</span>
                <span style={{ margin: "0 4px" }}>{" • "}</span>
              </>
            )}
            <span>
              Updated{" "}
              {formatDistanceToNow(new Date(evaluator.updatedAt), {
                addSuffix: true,
              })}
            </span>
          </Text>
        </VStack>
        <Menu.Root>
          <Menu.Trigger asChild>
            <IconButton
              variant="ghost"
              size="xs"
              aria-label="Actions"
              onClick={(e) => e.stopPropagation()}
              data-testid={`evaluator-menu-${evaluator.id}`}
            >
              <LuEllipsisVertical />
            </IconButton>
          </Menu.Trigger>
          <Menu.Content zIndex="popover">
            <Menu.Item
              value="edit"
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              data-testid={`evaluator-edit-${evaluator.id}`}
            >
              <LuPencil size={14} />
              Edit
            </Menu.Item>
            <Menu.Item
              value="use-from-api"
              onClick={(e) => {
                e.stopPropagation();
                onUseFromApi();
              }}
              data-testid={`evaluator-use-api-${evaluator.id}`}
            >
              <Code size={14} />
              Use via API
            </Menu.Item>
            <Menu.Item
              value="delete"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              color="red.500"
              data-testid={`evaluator-delete-${evaluator.id}`}
            >
              <LuTrash2 size={14} />
              Delete
            </Menu.Item>
          </Menu.Content>
        </Menu.Root>
      </HStack>
    </Box>
  );
}

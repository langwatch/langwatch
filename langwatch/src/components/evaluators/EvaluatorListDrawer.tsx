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
import { CheckCircle, Plus, Workflow } from "lucide-react";
import { LuEllipsisVertical, LuPencil, LuTrash2 } from "react-icons/lu";
import { formatDistanceToNow } from "date-fns";

import { Drawer } from "~/components/ui/drawer";
import { useDrawer, getComplexProps } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import type { Evaluator } from "@prisma/client";
import { MenuContent, MenuItem, MenuRoot, MenuTrigger } from "../ui/menu";

export type EvaluatorListDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  onSelect?: (evaluator: Evaluator) => void;
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

  const onClose = props.onClose ?? closeDrawer;
  const onSelect =
    props.onSelect ??
    (complexProps.onSelect as EvaluatorListDrawerProps["onSelect"]);
  const onCreateNew =
    props.onCreateNew ?? (() => openDrawer("evaluatorCategorySelector"));
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

  const handleSelectEvaluator = (evaluator: Evaluator) => {
    onSelect?.(evaluator);
    onClose();
  };

  const handleEditEvaluator = (evaluator: Evaluator) => {
    const config = evaluator.config as { evaluatorType?: string } | null;
    openDrawer("evaluatorEditor", {
      evaluatorId: evaluator.id,
      evaluatorType: config?.evaluatorType,
    });
  };

  const handleDeleteEvaluator = (evaluator: Evaluator) => {
    if (
      window.confirm(`Are you sure you want to delete "${evaluator.name}"?`)
    ) {
      deleteMutation.mutate({
        id: evaluator.id,
        projectId: project?.id ?? "",
      });
    }
  };

  return (
    <Drawer.Root
      open={isOpen}
      onOpenChange={({ open }) => !open && onClose()}
      size="md"
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
        <Drawer.Body display="flex" flexDirection="column" overflow="hidden" padding={0}>
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
                  />
                ))
              )}
            </VStack>
          </VStack>
        </Drawer.Body>
        <Drawer.Footer borderTopWidth="1px" borderColor="gray.200">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}

// ============================================================================
// Empty State Component
// ============================================================================

function EmptyState({ onCreateNew }: { onCreateNew: () => void }) {
  return (
    <VStack paddingY={24} gap={4} textAlign="center">
      <Box
        padding={4}
        borderRadius="full"
        bg="green.100"
        color="green.600"
      >
        <CheckCircle size={32} />
      </Box>
      <VStack gap={1}>
        <Text fontWeight="medium" color="gray.700">
          No evaluators yet
        </Text>
        <Text fontSize="sm" color="gray.500">
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

const evaluatorTypeLabels: Record<string, string> = {
  evaluator: "Built-in",
  workflow: "Workflow",
};

type EvaluatorCardProps = {
  evaluator: Evaluator;
  onClick: () => void;
  onEdit: () => void;
  onDelete: () => void;
};

function EvaluatorCard({
  evaluator,
  onClick,
  onEdit,
  onDelete,
}: EvaluatorCardProps) {
  const typeLabel = evaluatorTypeLabels[evaluator.type] ?? evaluator.type;
  const config = evaluator.config as { evaluatorType?: string } | null;
  const evaluatorType = config?.evaluatorType ?? "";

  return (
    <Box
      as="button"
      onClick={onClick}
      padding={4}
      borderRadius="md"
      border="1px solid"
      borderColor="gray.200"
      bg="white"
      textAlign="left"
      width="full"
      _hover={{ borderColor: "green.400", bg: "green.50" }}
      transition="all 0.15s"
      data-testid={`evaluator-card-${evaluator.id}`}
      position="relative"
    >
      <HStack gap={3}>
        <Box color="green.500">
          {evaluator.type === "workflow" ? (
            <Workflow size={20} />
          ) : (
            <CheckCircle size={20} />
          )}
        </Box>
        <VStack align="start" gap={0} flex={1}>
          <Text fontWeight="medium" fontSize="sm">
            {evaluator.name}
          </Text>
          <HStack gap={2} fontSize="xs" color="gray.500">
            <Text>{typeLabel}</Text>
            {evaluatorType && (
              <>
                <Text>•</Text>
                <Text>{evaluatorType}</Text>
              </>
            )}
            <Text>•</Text>
            <Text>
              Updated{" "}
              {formatDistanceToNow(new Date(evaluator.updatedAt), {
                addSuffix: true,
              })}
            </Text>
          </HStack>
        </VStack>
        <MenuRoot>
          <MenuTrigger asChild>
            <IconButton
              variant="ghost"
              size="sm"
              aria-label="Actions"
              onClick={(e) => e.stopPropagation()}
              data-testid={`evaluator-menu-${evaluator.id}`}
            >
              <LuEllipsisVertical size={16} />
            </IconButton>
          </MenuTrigger>
          <MenuContent>
            <MenuItem
              value="edit"
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              data-testid={`evaluator-edit-${evaluator.id}`}
            >
              <LuPencil size={14} />
              Edit
            </MenuItem>
            <MenuItem
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
            </MenuItem>
          </MenuContent>
        </MenuRoot>
      </HStack>
    </Box>
  );
}

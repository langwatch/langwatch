import { Box, HStack, IconButton, Text, VStack } from "@chakra-ui/react";
import { CheckCircle, Code, Workflow } from "lucide-react";
import type { MouseEvent } from "react";
import { LuEllipsisVertical, LuPencil, LuTrash2 } from "react-icons/lu";
import { Menu } from "@langwatch/design-system/menu";
import {
  AVAILABLE_EVALUATORS,
  evaluatorDisplayName,
  type Evaluator,
  type EvaluatorTypes,
} from "@langwatch/evaluator-contract";

export type EvaluatorListItemProps = {
  evaluator: Evaluator;
  updatedAtLabel: string;
  onClick: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onUseFromApi: () => void;
};

function getEvaluatorDisplayName(evaluatorType: string): string {
  if (!evaluatorType) return "";

  const evaluatorDefinition = AVAILABLE_EVALUATORS[evaluatorType as EvaluatorTypes];
  if (!evaluatorDefinition) return evaluatorType;

  return evaluatorDisplayName(evaluatorDefinition.name);
}

function stopPropagation(callback: () => void) {
  return (event: MouseEvent) => {
    event.stopPropagation();
    callback();
  };
}

export function EvaluatorListItem({
  evaluator,
  updatedAtLabel,
  onClick,
  onEdit,
  onDelete,
  onUseFromApi,
}: EvaluatorListItemProps) {
  const config = evaluator.config as { evaluatorType?: string } | null;
  const evaluatorType = config?.evaluatorType ?? "";
  const displayName =
    evaluator.type === "workflow"
      ? "Workflow"
      : evaluator.type === "code"
        ? "Code"
        : getEvaluatorDisplayName(evaluatorType);

  return (
    <Box
      role="button"
      tabIndex={0}
      cursor="pointer"
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
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
          ) : evaluator.type === "code" ? (
            <Code size={16} />
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
            <span>Updated {updatedAtLabel}</span>
          </Text>
        </VStack>
        <Menu.Root>
          <Menu.Trigger asChild>
            <IconButton
              variant="ghost"
              size="xs"
              aria-label="Actions"
              onClick={(event) => event.stopPropagation()}
              data-testid={`evaluator-menu-${evaluator.id}`}
            >
              <LuEllipsisVertical />
            </IconButton>
          </Menu.Trigger>
          <Menu.Content>
            <Menu.Item
              value="edit"
              onClick={stopPropagation(onEdit)}
              data-testid={`evaluator-edit-${evaluator.id}`}
            >
              <LuPencil size={14} />
              Edit
            </Menu.Item>
            <Menu.Item
              value="use-from-api"
              onClick={stopPropagation(onUseFromApi)}
              data-testid={`evaluator-use-api-${evaluator.id}`}
            >
              <Code size={14} />
              Use via API
            </Menu.Item>
            <Menu.Item
              value="delete"
              onClick={stopPropagation(onDelete)}
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

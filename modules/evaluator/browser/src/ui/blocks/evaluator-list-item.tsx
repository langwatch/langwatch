import { Box, chakra, HStack, IconButton, Text, VStack } from "@chakra-ui/react";
import type { WireOf } from "@langwatch/api/web";
import { Menu } from "@langwatch/design-system/menu";
import {
  AVAILABLE_EVALUATORS,
  evaluatorDisplayName,
  type Evaluator,
  type EvaluatorTypes,
} from "@langwatch/evaluator-contract";
import { CheckCircle, Code, Workflow } from "lucide-react";
import type { MouseEvent } from "react";
import { LuEllipsisVertical, LuPencil, LuTrash2 } from "react-icons/lu";

export type EvaluatorListItemProps = {
  evaluator: WireOf<Evaluator>;
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

function evaluatorKindDisplayName(
  kind: EvaluatorListItemProps["evaluator"]["type"],
  evaluatorType: string,
): string {
  if (kind === "workflow") return "Workflow";
  if (kind === "code") return "Code";
  return getEvaluatorDisplayName(evaluatorType);
}

function EvaluatorKindIcon({ kind }: { kind: EvaluatorListItemProps["evaluator"]["type"] }) {
  if (kind === "workflow") return <Workflow size={16} />;
  if (kind === "code") return <Code size={16} />;
  return <CheckCircle size={16} />;
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
  const displayName = evaluatorKindDisplayName(evaluator.type, evaluatorType);

  return (
    <Box
      cursor="pointer"
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
      <chakra.button
        type="button"
        aria-label={evaluator.name}
        position="absolute"
        inset={0}
        borderRadius="md"
        cursor="pointer"
      />
      <HStack gap={3} align="start">
        <Box color="green.fg" paddingTop={1}>
          <EvaluatorKindIcon kind={evaluator.type} />
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
              position="relative"
              zIndex={1}
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

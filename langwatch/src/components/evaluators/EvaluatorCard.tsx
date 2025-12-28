import { Box, Card, HStack, Spacer, Text, VStack } from "@chakra-ui/react";
import { CheckSquare, MoreVertical, Workflow } from "lucide-react";
import { LuPencil, LuTrash2 } from "react-icons/lu";
import type { Evaluator } from "@prisma/client";
import { Menu } from "../ui/menu";
import { formatTimeAgo } from "~/utils/formatTimeAgo";

const evaluatorTypeIcons: Record<string, typeof CheckSquare> = {
  evaluator: CheckSquare,
  workflow: Workflow,
};

const evaluatorTypeLabels: Record<string, string> = {
  evaluator: "Built-in",
  workflow: "Workflow",
};

export type EvaluatorCardProps = {
  evaluator: Evaluator;
  onClick?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
};

export function EvaluatorCard({
  evaluator,
  onClick,
  onEdit,
  onDelete,
}: EvaluatorCardProps) {
  const Icon = evaluatorTypeIcons[evaluator.type] ?? CheckSquare;
  const typeLabel = evaluatorTypeLabels[evaluator.type] ?? evaluator.type;

  // Extract evaluator type from config if available
  const config = evaluator.config as { evaluatorType?: string } | null;
  const evaluatorType = config?.evaluatorType;

  return (
    <Card.Root
      variant="elevated"
      onClick={onClick}
      cursor="pointer"
      height="142px"
      transition="all 0.2s ease-in-out"
      data-testid={`evaluator-card-${evaluator.id}`}
    >
      <Card.Body padding={4}>
        <VStack align="start" gap={2} height="full">
          {/* Top row: Icon and menu */}
          <HStack width="full">
            <Box bg="green.50" padding={1} borderRadius="md">
              <Icon size={18} color="var(--chakra-colors-green-600)" />
            </Box>
            <Spacer />
            {(onEdit || onDelete) && (
              <Menu.Root>
                <Menu.Trigger
                  className="js-inner-menu"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreVertical size={16} />
                </Menu.Trigger>
                <Menu.Content className="js-inner-menu">
                  {onEdit && (
                    <Menu.Item
                      value="edit"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEdit();
                      }}
                    >
                      <LuPencil size={14} />
                      Edit
                    </Menu.Item>
                  )}
                  {onDelete && (
                    <Menu.Item
                      value="delete"
                      color="red.500"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete();
                      }}
                    >
                      <LuTrash2 size={14} />
                      Delete
                    </Menu.Item>
                  )}
                </Menu.Content>
              </Menu.Root>
            )}
          </HStack>

          <Spacer />

          {/* Name */}
          <Text color="gray.600" fontSize="sm" fontWeight={500}>
            {evaluator.name}
          </Text>

          {/* Metadata */}
          <Text color="gray.400" fontSize="12px">
            {typeLabel}
            {evaluatorType && ` • ${evaluatorType}`} •{" "}
            {formatTimeAgo(new Date(evaluator.updatedAt).getTime())}
          </Text>
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}

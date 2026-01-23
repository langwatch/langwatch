import { Box, Card, HStack, Spacer, Text, VStack } from "@chakra-ui/react";
import type { Evaluator } from "@prisma/client";
import { CheckSquare, Code, MoreVertical, Workflow } from "lucide-react";
import { useState } from "react";
import { LuPencil, LuTrash2 } from "react-icons/lu";
import { formatTimeAgo } from "~/utils/formatTimeAgo";
import { Menu } from "../ui/menu";
import { EvaluatorApiUsageDialog } from "./EvaluatorApiUsageDialog";

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
  onUseFromApi?: () => void;
};

export function EvaluatorCard({
  evaluator,
  onClick,
  onEdit,
  onDelete,
  onUseFromApi,
}: EvaluatorCardProps) {
  const Icon = evaluatorTypeIcons[evaluator.type] ?? CheckSquare;
  const typeLabel = evaluatorTypeLabels[evaluator.type] ?? evaluator.type;

  // State for API usage dialog
  const [showApiDialog, setShowApiDialog] = useState(false);

  // Extract evaluator type from config if available
  const config = evaluator.config as { evaluatorType?: string } | null;
  const evaluatorType = config?.evaluatorType;

  const handleUseFromApi = () => {
    if (onUseFromApi) {
      onUseFromApi();
    } else {
      setShowApiDialog(true);
    }
  };

  return (
    <>
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
              <Box bg="green.subtle" padding={1} borderRadius="md">
                <Icon size={18} color="var(--chakra-colors-green-fg)" />
              </Box>
              <Spacer />
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
                  <Menu.Item
                    value="use-from-api"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleUseFromApi();
                    }}
                    data-testid={`evaluator-use-api-${evaluator.id}`}
                  >
                    <Code size={14} />
                    Use via API
                  </Menu.Item>
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
            </HStack>

            <Spacer />

            {/* Name */}
            <Text color="fg.muted" fontSize="sm" fontWeight={500}>
              {evaluator.name}
            </Text>

            {/* Metadata */}
            <Text color="fg.subtle" fontSize="12px">
              {typeLabel}
              {evaluatorType && ` • ${evaluatorType}`} •{" "}
              {formatTimeAgo(new Date(evaluator.updatedAt).getTime())}
            </Text>
          </VStack>
        </Card.Body>
      </Card.Root>

      {/* API Usage Dialog - rendered outside Card to prevent click propagation */}
      <EvaluatorApiUsageDialog
        evaluator={evaluator}
        open={showApiDialog}
        onClose={() => setShowApiDialog(false)}
      />
    </>
  );
}

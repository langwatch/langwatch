import { Box, Card, HStack, Spacer, Text, VStack } from "@chakra-ui/react";
import type { Evaluator } from "@langwatch/evaluator-contract";
import { Menu } from "@langwatch/design-system/menu";
import {
  ArrowUp,
  CheckSquare,
  Clock,
  Code,
  Copy,
  MoreVertical,
  RefreshCw,
  Workflow,
} from "lucide-react";
import type { MouseEvent } from "react";
import { LuPencil, LuTrash2 } from "react-icons/lu";

const evaluatorTypeIcons = {
  evaluator: CheckSquare,
  workflow: Workflow,
} as const;

const evaluatorTypeLabels = {
  evaluator: "Built-in",
  workflow: "Workflow",
} as const;

export type EvaluatorCardProps = {
  evaluator: Evaluator;
  updatedAtLabel: string;
  onClick?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onUseFromApi?: () => void;
  onReplicate?: () => void;
  onPushToCopies?: () => void;
  onSyncFromSource?: () => void;
  onViewHistory?: () => void;
};

/** Presentation-only evaluator card. Host code owns dialogs and workflows. */
export function EvaluatorCard({
  evaluator,
  updatedAtLabel,
  onClick,
  onEdit,
  onDelete,
  onUseFromApi,
  onReplicate,
  onPushToCopies,
  onSyncFromSource,
  onViewHistory,
}: EvaluatorCardProps) {
  const Icon =
    evaluatorTypeIcons[evaluator.type as keyof typeof evaluatorTypeIcons] ??
    CheckSquare;
  const typeLabel =
    evaluatorTypeLabels[evaluator.type as keyof typeof evaluatorTypeLabels] ??
    evaluator.type;
  const evaluatorType = (
    evaluator.config as { evaluatorType?: string } | null
  )?.evaluatorType;
  const isCopiedEvaluator = Boolean(evaluator.copiedFromEvaluatorId);
  const hasCopies =
    (evaluator.copyCount ?? evaluator._count?.copiedEvaluators ?? 0) > 0;
  const stop =
    (callback: () => void) => (event: MouseEvent) => {
      event.stopPropagation();
      callback();
    };

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
          <HStack width="full">
            <Box bg="green.subtle" padding={1} borderRadius="md">
              <Icon size={18} color="var(--chakra-colors-green-fg)" />
            </Box>
            <Spacer />
            <Menu.Root>
              <Menu.Trigger
                className="js-inner-menu"
                onClick={(event) => event.stopPropagation()}
              >
                <MoreVertical size={16} />
              </Menu.Trigger>
              <Menu.Content className="js-inner-menu">
                {onEdit && (
                  <Menu.Item value="edit" onClick={stop(onEdit)}>
                    <LuPencil size={14} /> Edit
                  </Menu.Item>
                )}
                {onUseFromApi && (
                  <Menu.Item
                    value="use-from-api"
                    onClick={stop(onUseFromApi)}
                    data-testid={`evaluator-use-api-${evaluator.id}`}
                  >
                    <Code size={14} /> Use via API
                  </Menu.Item>
                )}
                {isCopiedEvaluator && onSyncFromSource && (
                  <Menu.Item value="sync" onClick={stop(onSyncFromSource)}>
                    <RefreshCw size={16} /> Update from source
                  </Menu.Item>
                )}
                {hasCopies && onPushToCopies && (
                  <Menu.Item value="push" onClick={stop(onPushToCopies)}>
                    <ArrowUp size={16} /> Push to replicas
                  </Menu.Item>
                )}
                {onReplicate && (
                  <Menu.Item value="replicate" onClick={stop(onReplicate)}>
                    <Copy size={16} /> Replicate to another project
                  </Menu.Item>
                )}
                {onViewHistory && (
                  <Menu.Item value="history" onClick={stop(onViewHistory)}>
                    <Clock size={14} /> View history
                  </Menu.Item>
                )}
                {onDelete && (
                  <Menu.Item value="delete" color="red.500" onClick={stop(onDelete)}>
                    <LuTrash2 size={14} /> Delete
                  </Menu.Item>
                )}
              </Menu.Content>
            </Menu.Root>
          </HStack>
          <Spacer />
          <Text
            color="fg"
            fontSize="sm"
            fontWeight={500}
            lineClamp={2}
            width="full"
            wordBreak="break-word"
          >
            {evaluator.name}
          </Text>
          <Text color="fg.subtle" fontSize="12px" lineClamp={1} width="full">
            {typeLabel}
            {evaluatorType && ` • ${evaluatorType}`} • {updatedAtLabel}
          </Text>
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}

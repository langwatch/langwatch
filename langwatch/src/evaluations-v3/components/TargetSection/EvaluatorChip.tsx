import {
  Box,
  Button,
  Circle,
  HStack,
  Icon,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { keyframes } from "@emotion/react";
import {
  LuChevronDown,
  LuCircleAlert,
  LuCircleX,
  LuPencil,
  LuRefreshCw,
  LuTrash2,
} from "react-icons/lu";

import { Menu } from "~/components/ui/menu";
import {
  EVALUATION_STATUS_COLORS,
  getStatusLabel,
  parseEvaluationResult,
} from "~/utils/evaluationResults";
import { parseLLMError } from "~/utils/formatLLMError";
import { useEvaluatorName } from "../../hooks/useEvaluatorName";
import type { EvaluatorConfig } from "../../types";

// Pulsing animation for alert icon
const pulseAnimation = keyframes`
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.2); }
`;

type EvaluatorChipProps = {
  evaluator: EvaluatorConfig;
  result: unknown;
  /** Whether this evaluator has missing required mappings */
  hasMissingMappings?: boolean;
  /** Whether this specific evaluator is currently running (from runningEvaluators state) */
  isRunning?: boolean;
  onEdit: () => void;
  onRemove: () => void;
  /** Called when user wants to re-run this evaluator */
  onRerun?: () => void;
};

export function EvaluatorChip({
  evaluator,
  result,
  hasMissingMappings = false,
  isRunning = false,
  onEdit,
  onRemove,
  onRerun,
}: EvaluatorChipProps) {
  const evaluatorName = useEvaluatorName(evaluator);
  const parsed = parseEvaluationResult(result);

  // Use explicit isRunning state from store (set when target output arrives, cleared when evaluator result arrives)
  // If result already exists, it overrides isRunning (evaluator completed)
  const status =
    isRunning && parsed.status === "pending" ? "running" : parsed.status;
  const { score, label, details } = parsed;

  const statusColor = EVALUATION_STATUS_COLORS[status];

  // Format inline result display
  const getInlineResult = () => {
    if (status === "pending") return null;

    // Show spinner when running
    if (status === "running") {
      return <Spinner size="xs" color="fg.muted" />;
    }

    // Show error icon for error status
    if (status === "error") {
      return <Icon as={LuCircleX} color={statusColor} boxSize="12px" />;
    }

    if (score !== undefined) {
      return (
        <Text fontSize="10px" fontWeight="semibold">
          {score.toFixed(2)}
        </Text>
      );
    }
    if (label) {
      return (
        <Text fontSize="10px" fontWeight="medium" maxWidth="60px" truncate>
          {label}
        </Text>
      );
    }
    return null;
  };

  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button
          variant="outline"
          size="xs"
          fontSize="11px"
          fontWeight="medium"
          borderColor={hasMissingMappings ? "orange.solid" : undefined}
          minWidth={0}
          maxWidth="100%"
          css={{
            "& .chevron-icon": {
              display: "none",
            },
            "&:hover .chevron-icon": {
              display: "block",
            },
          }}
        >
          <HStack gap={1.5} minWidth={0}>
            {/* Status indicator - spinning for running, static for others */}
            {status === "running" ? (
              <Box flexShrink={0}>
                <Spinner size="xs" color="fg.muted" marginBottom="-2px" />
              </Box>
            ) : (
              <Circle size="10px" bg={statusColor} flexShrink={0} />
            )}
            <Text
              css={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {evaluatorName}
            </Text>
            {/* Inline result (score, label, or error icon) */}
            {status !== "running" && getInlineResult()}
            {/* Missing mapping alert icon - on the right side like prompts */}
            {hasMissingMappings && (
              <Icon
                as={LuCircleAlert}
                color="yellow.fg"
                boxSize="14px"
                css={{ animation: `${pulseAnimation} 2s ease-in-out infinite` }}
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit();
                }}
                data-testid={`evaluator-missing-mapping-alert-${evaluator.id}`}
              />
            )}
            <Box className="chevron-icon" marginLeft={-0.5}>
              <LuChevronDown size={12} />
            </Box>
          </HStack>
        </Button>
      </Menu.Trigger>
      <Menu.Content minWidth="220px" maxWidth="360px">
        {/* Result section (if there's a result) */}
        {status !== "pending" && (
          <>
            <Box paddingX={3} paddingY={2}>
              <Text
                fontSize="11px"
                fontWeight="semibold"
                color="fg.muted"
                marginBottom={1}
              >
                Result
              </Text>
              <VStack align="stretch" gap={1}>
                {score !== undefined && (
                  <HStack justify="space-between">
                    <Text fontSize="12px" color="fg.muted">
                      Score:
                    </Text>
                    <Text fontSize="12px" fontWeight="semibold">
                      {score.toFixed(2)}
                    </Text>
                  </HStack>
                )}
                {label && (
                  <HStack justify="space-between">
                    <Text fontSize="12px" color="fg.muted">
                      Label:
                    </Text>
                    <Text fontSize="12px" fontWeight="semibold">
                      {label}
                    </Text>
                  </HStack>
                )}
                <HStack justify="space-between">
                  <Text fontSize="12px" color="fg.muted">
                    Status:
                  </Text>
                  <Text
                    fontSize="12px"
                    fontWeight="semibold"
                    color={statusColor}
                  >
                    {getStatusLabel(status)}
                  </Text>
                </HStack>
                {details && (
                  <Box marginTop={1}>
                    <Text fontSize="11px" color="fg.muted" marginBottom={0.5}>
                      Details:
                    </Text>
                    <Text
                      fontSize="11px"
                      color="fg.muted"
                      whiteSpace="pre-wrap"
                      maxHeight="200px"
                      overflow="auto"
                    >
                      {parseLLMError(details).message}
                    </Text>
                  </Box>
                )}
              </VStack>
            </Box>
            <Box borderTopWidth="1px" borderColor="border" />
          </>
        )}
        {/* Show Rerun option only if evaluator has been run (not pending) and not currently running */}
        {status !== "pending" && status !== "running" && onRerun && (
          <Menu.Item value="rerun" onClick={onRerun}>
            <HStack gap={2}>
              <LuRefreshCw size={14} />
              <Text>Rerun</Text>
            </HStack>
          </Menu.Item>
        )}
        <Menu.Item value="edit" onClick={onEdit}>
          <HStack gap={2}>
            <LuPencil size={14} />
            <Text>Edit Configuration</Text>
          </HStack>
        </Menu.Item>
        <Box borderTopWidth="1px" borderColor="border" my={1} />
        <Menu.Item value="remove" onClick={onRemove}>
          <HStack gap={2} color="red.fg">
            <LuTrash2 size={14} />
            <Text>Remove from Workbench</Text>
          </HStack>
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}

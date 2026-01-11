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
import {
  LuCircleAlert,
  LuChevronDown,
  LuPencil,
  LuTrash2,
  LuCircleX,
} from "react-icons/lu";
import { keyframes } from "@emotion/react";

import { Menu } from "~/components/ui/menu";
import {
  parseEvaluationResult,
  EVALUATION_STATUS_COLORS,
  getStatusLabel,
} from "~/utils/evaluationResults";
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
  /** Whether the target has finished and this evaluator should be running */
  targetHasOutput?: boolean;
  /** Whether the overall execution is still running */
  isExecutionRunning?: boolean;
  onEdit: () => void;
  onRemove: () => void;
};

export function EvaluatorChip({
  evaluator,
  result,
  hasMissingMappings = false,
  targetHasOutput = false,
  isExecutionRunning = false,
  onEdit,
  onRemove,
}: EvaluatorChipProps) {
  const parsed = parseEvaluationResult(result);

  // If target has finished but evaluator hasn't returned yet AND execution is still running, show as running
  // If execution has stopped but we have no result, show as pending (skipped)
  const status =
    parsed.status === "pending" && targetHasOutput && isExecutionRunning
      ? "running"
      : parsed.status;
  const { score, label, details } = parsed;

  const statusColor = EVALUATION_STATUS_COLORS[status];

  // Format inline result display
  const getInlineResult = () => {
    if (status === "pending") return null;

    // Show spinner when running
    if (status === "running") {
      return <Spinner size="xs" color="gray.500" />;
    }

    // Show error icon for error status
    if (status === "error") {
      return (
        <Icon as={LuCircleX} color={statusColor} boxSize="12px" />
      );
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
        <Text
          fontSize="10px"
          fontWeight="medium"
          maxWidth="60px"
          truncate
        >
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
          borderColor={hasMissingMappings ? "orange.400" : undefined}
          css={{
            "& .chevron-icon": {
              display: "none",
            },
            "&:hover .chevron-icon": {
              display: "block",
            },
          }}
        >
          <HStack gap={1.5}>
            {/* Status indicator - spinning for running, static for others */}
            {status === "running" ? (
              <Box flexShrink={0}>
                <Spinner size="xs" color="gray.500" marginBottom="-2px" />
              </Box>
            ) : (
              <Circle size="10px" bg={statusColor} flexShrink={0} />
            )}
            <Text>{evaluator.name}</Text>
            {/* Inline result (score, label, or error icon) */}
            {status !== "running" && getInlineResult()}
            {/* Missing mapping alert icon - on the right side like prompts */}
            {hasMissingMappings && (
              <Icon
                as={LuCircleAlert}
                color="yellow.500"
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
                color="gray.500"
                marginBottom={1}
              >
                Result
              </Text>
              <VStack align="stretch" gap={1}>
                {score !== undefined && (
                  <HStack justify="space-between">
                    <Text fontSize="12px" color="gray.600">
                      Score:
                    </Text>
                    <Text
                      fontSize="12px"
                      fontWeight="semibold"
                    >
                      {score.toFixed(2)}
                    </Text>
                  </HStack>
                )}
                {label && (
                  <HStack justify="space-between">
                    <Text fontSize="12px" color="gray.600">
                      Label:
                    </Text>
                    <Text
                      fontSize="12px"
                      fontWeight="semibold"
                    >
                      {label}
                    </Text>
                  </HStack>
                )}
                <HStack justify="space-between">
                  <Text fontSize="12px" color="gray.600">
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
                    <Text fontSize="11px" color="gray.500" marginBottom={0.5}>
                      Details:
                    </Text>
                    <Text
                      fontSize="11px"
                      color="gray.600"
                      whiteSpace="pre-wrap"
                      maxHeight="100px"
                      overflow="auto"
                    >
                      {details}
                    </Text>
                  </Box>
                )}
              </VStack>
            </Box>
            <Box borderTopWidth="1px" borderColor="gray.200" />
          </>
        )}
        <Menu.Item value="edit" onClick={onEdit}>
          <HStack gap={2}>
            <LuPencil size={14} />
            <Text>Edit Configuration</Text>
          </HStack>
        </Menu.Item>
        <Box borderTopWidth="1px" borderColor="gray.200" my={1} />
        <Menu.Item value="remove" onClick={onRemove}>
          <HStack gap={2} color="red.600">
            <LuTrash2 size={14} />
            <Text>Remove from Workbench</Text>
          </HStack>
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}

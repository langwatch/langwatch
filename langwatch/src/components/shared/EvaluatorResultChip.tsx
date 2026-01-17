/**
 * EvaluatorResultChip - A read-only chip displaying evaluator result status
 *
 * This is a shared component used by both:
 * - Evaluations V3 workbench (via the interactive EvaluatorChip wrapper)
 * - Batch evaluation results page (read-only display)
 *
 * For the interactive version with edit/remove menu, see:
 * evaluations-v3/components/TargetSection/EvaluatorChip.tsx
 */
import {
  Box,
  Circle,
  HStack,
  Icon,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { LuCircleX } from "react-icons/lu";

import { Tooltip } from "~/components/ui/tooltip";
import {
  EVALUATION_STATUS_COLORS,
  getStatusLabel,
  type ParsedEvaluationResult,
  parseEvaluationResult,
} from "~/utils/evaluationResults";

export type EvaluationStatus = ParsedEvaluationResult["status"];

export type EvaluatorResultChipProps = {
  /** Display name of the evaluator */
  name: string;
  /** The raw result to parse and display */
  result: unknown;
  /** Override status (e.g., for showing running when target finished but evaluator pending) */
  statusOverride?: EvaluationStatus;
  /** Optional children to render after the chip content (e.g., dropdown trigger) */
  children?: React.ReactNode;
};

/**
 * Base chip that displays evaluator result - read-only version
 */
export function EvaluatorResultChip({
  name,
  result,
  statusOverride,
  children,
}: EvaluatorResultChipProps) {
  const parsed = parseEvaluationResult(result);
  const status = statusOverride ?? parsed.status;
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

  // Build tooltip content
  const tooltipContent =
    status !== "pending" ? (
      <VStack align="stretch" gap={1} padding={2}>
        {score !== undefined && (
          <HStack justify="space-between" gap={4}>
            <Text fontSize="12px" color="gray.300">
              Score:
            </Text>
            <Text fontSize="12px" fontWeight="semibold" color="white">
              {score.toFixed(2)}
            </Text>
          </HStack>
        )}
        {label && (
          <HStack justify="space-between" gap={4}>
            <Text fontSize="12px" color="gray.300">
              Label:
            </Text>
            <Text fontSize="12px" fontWeight="semibold" color="white">
              {label}
            </Text>
          </HStack>
        )}
        <HStack justify="space-between" gap={4}>
          <Text fontSize="12px" color="gray.300">
            Status:
          </Text>
          <Text fontSize="12px" fontWeight="semibold" color={statusColor}>
            {getStatusLabel(status)}
          </Text>
        </HStack>
        {details && (
          <Box marginTop={1}>
            <Text fontSize="12px" color="gray.400" marginBottom={0.5}>
              Details:
            </Text>
            <Text
              fontSize="12px"
              color="gray.300"
              whiteSpace="pre-wrap"
              maxHeight="100px"
              overflow="auto"
            >
              {details}
            </Text>
          </Box>
        )}
      </VStack>
    ) : (
      <Text fontSize="12px">Pending</Text>
    );

  const chipContent = (
    <HStack
      gap={1.5}
      paddingX={2}
      paddingY={1}
      borderRadius="md"
      borderWidth="1px"
      borderColor="gray.200"
      bg="white"
      fontSize="11px"
      fontWeight="medium"
      cursor="default"
    >
      {/* Status indicator - spinning for running, static for others */}
      {status === "running" ? (
        <Box flexShrink={0}>
          <Spinner size="xs" color="gray.500" marginBottom="-2px" />
        </Box>
      ) : (
        <Circle size="10px" bg={statusColor} flexShrink={0} />
      )}
      <Text>{name}</Text>
      {/* Inline result (score, label, or error icon) */}
      {status !== "running" && getInlineResult()}
      {children}
    </HStack>
  );

  return (
    <Tooltip
      content={tooltipContent}
      positioning={{ placement: "top" }}
      openDelay={200}
      closeDelay={200}
      interactive
    >
      {chipContent}
    </Tooltip>
  );
}

/**
 * Re-export utilities for convenience
 */
export { parseEvaluationResult, EVALUATION_STATUS_COLORS, getStatusLabel };

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
import { LuChevronRight, LuCircleX } from "react-icons/lu";

import { Tooltip } from "~/components/ui/tooltip";
import { useInteractiveTooltip } from "~/hooks/useInteractiveTooltip";
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
  /** Optional evaluator inputs (data= from evaluation.log) to display in tooltip */
  inputs?: Record<string, unknown>;
  /** Optional children to render after the chip content (e.g., dropdown trigger) */
  children?: React.ReactNode;
};

/**
 * Sub-tooltip content for displaying evaluator inputs data
 */
const DataTooltipContent = ({ inputs }: { inputs: Record<string, unknown> }) => (
  <VStack align="stretch" gap={1} padding={2} maxWidth="300px">
    <Text fontSize="12px" fontWeight="semibold" color="white" marginBottom={1}>
      Evaluator Inputs
    </Text>
    <Box
      fontSize="11px"
      fontFamily="mono"
      color="gray.300"
      whiteSpace="pre-wrap"
      wordBreak="break-word"
      maxHeight="250px"
      overflow="auto"
    >
      {JSON.stringify(inputs, null, 2)}
    </Box>
  </VStack>
);

/**
 * Base chip that displays evaluator result - read-only version
 *
 * NOTE: When inputs are provided, we use useInteractiveTooltip to manually
 * manage tooltip state, allowing nested tooltips (for the Data sub-tooltip)
 * to work correctly.
 */
export function EvaluatorResultChip({
  name,
  result,
  statusOverride,
  inputs,
  children,
}: EvaluatorResultChipProps) {
  const parsed = parseEvaluationResult(result);
  const status = statusOverride ?? parsed.status;
  const { score, label, details } = parsed;
  const statusColor = EVALUATION_STATUS_COLORS[status];

  // Use interactive tooltip when we have inputs (nested tooltip)
  const hasInputs = inputs && Object.keys(inputs).length > 0;
  const { isOpen, handleMouseEnter, handleMouseLeave } =
    useInteractiveTooltip(150);

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
            <Text fontSize="12px" color="fg.subtle" marginBottom={0.5}>
              Details:
            </Text>
            <Text
              fontSize="12px"
              color="gray.300"
              whiteSpace="pre-wrap"
              maxHeight="200px"
              overflow="auto"
            >
              {details}
            </Text>
          </Box>
        )}
        {/* Data sub-tooltip - only shown when inputs exist */}
        {hasInputs && (
          <Tooltip
            content={<DataTooltipContent inputs={inputs} />}
            positioning={{ placement: "right" }}
            openDelay={100}
            interactive
          >
            <HStack
              justify="space-between"
              cursor="pointer"
              _hover={{ bg: "white/10" }}
              marginX={-2}
              paddingX={2}
              paddingY={1}
              borderRadius="md"
              marginTop={1}
            >
              <Text fontSize="12px" color="gray.300">
                Data
              </Text>
              <Icon as={LuChevronRight} boxSize={3} color="white/50" />
            </HStack>
          </Tooltip>
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
      borderColor="border"
      bg="white"
      fontSize="11px"
      fontWeight="medium"
      cursor="default"
      onMouseEnter={hasInputs ? handleMouseEnter : undefined}
      onMouseLeave={hasInputs ? handleMouseLeave : undefined}
    >
      {/* Status indicator - spinning for running, static for others */}
      {status === "running" ? (
        <Box flexShrink={0}>
          <Spinner size="xs" color="fg.muted" marginBottom="-2px" />
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

  // When we have inputs, use controlled tooltip with interactive behavior
  if (hasInputs) {
    return (
      <Tooltip
        content={tooltipContent}
        contentProps={{
          onMouseEnter: handleMouseEnter,
          onMouseLeave: handleMouseLeave,
        }}
        positioning={{ placement: "top" }}
        open={isOpen}
        interactive
      >
        {chipContent}
      </Tooltip>
    );
  }

  // Simple tooltip when no inputs
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

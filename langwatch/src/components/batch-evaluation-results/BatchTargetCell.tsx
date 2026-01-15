/**
 * BatchTargetCell - Displays a target's output and evaluator results in the batch results table
 *
 * This is a read-only version for displaying historical evaluation results.
 * For the interactive workbench version, see evaluations-v3/components/TargetSection/TargetCell.tsx
 */
import { useCallback, useState, useRef } from "react";
import { Box, Button, HStack, Portal, Text, VStack } from "@chakra-ui/react";
import { LuListTree, LuCircleAlert, LuCopy, LuCheck } from "react-icons/lu";

import { useDrawer } from "~/hooks/useDrawer";
import { Tooltip } from "~/components/ui/tooltip";
import { EvaluatorResultChip } from "~/components/shared/EvaluatorResultChip";
import { formatLatency } from "~/components/shared/formatters";
import type { BatchTargetOutput, BatchEvaluatorResult } from "./types";

// Max characters to display for performance
const MAX_DISPLAY_CHARS = 10000;

// Max height for collapsed output
const OUTPUT_MAX_HEIGHT = 120;

// Approximate chars that fit before overflow (rough heuristic to avoid useEffect flicker)
const OVERFLOW_CHAR_THRESHOLD = 200;

/**
 * Unwrap output if it's an object with only a single "output" key
 * e.g., {"output": "lorem ipsum"} -> "lorem ipsum"
 */
const unwrapSingleOutputField = (
  output: Record<string, unknown> | null
): unknown => {
  if (output === null || output === undefined) return output;
  if (typeof output !== "object") return output;

  const keys = Object.keys(output);
  // Only unwrap if there's exactly one key and it's "output"
  if (keys.length === 1 && keys[0] === "output") {
    return output.output;
  }

  return output;
};

type BatchTargetCellProps = {
  /** Target output data for this row */
  targetOutput: BatchTargetOutput;
  /** Callback to get result object for an evaluator */
  getEvaluatorResult?: (evaluatorId: string) => BatchEvaluatorResult | undefined;
};

export function BatchTargetCell({
  targetOutput,
  getEvaluatorResult,
}: BatchTargetCellProps) {
  const { openDrawer } = useDrawer();

  // State for expanded output view
  const [isOutputExpanded, setIsOutputExpanded] = useState(false);
  const [hasCopied, setHasCopied] = useState(false);
  const cellRef = useRef<HTMLDivElement>(null);
  const [expandedPosition, setExpandedPosition] = useState({
    top: 0,
    left: 0,
    width: 0,
  });

  // Handler to open trace drawer
  const handleViewTrace = useCallback(() => {
    if (!targetOutput.traceId) return;
    setIsOutputExpanded(false);
    openDrawer("traceDetails", { traceId: targetOutput.traceId });
  }, [targetOutput.traceId, openDrawer]);

  // Handler to expand output
  const handleExpandOutput = useCallback(() => {
    if (cellRef.current) {
      // Use the cell ref's own position (works correctly in diff mode where multiple
      // values share the same td, each value should expand from its own position)
      const rect = cellRef.current.getBoundingClientRect();
      // Also get the td width to use as min width
      const td = cellRef.current.closest("td");
      const tdWidth = td?.getBoundingClientRect().width ?? rect.width;
      
      const expandedWidth = Math.max(rect.width, tdWidth) + 24;
      const safetyMargin = 32;
      const viewportWidth = window.innerWidth;
      
      // Adjust left position if it would overflow the viewport
      let left = rect.left - 12;
      if (left + expandedWidth > viewportWidth - safetyMargin) {
        left = viewportWidth - expandedWidth - safetyMargin;
      }
      
      setExpandedPosition({
        top: rect.top,
        left,
        width: expandedWidth,
      });
    }
    setIsOutputExpanded(true);
  }, []);

  // Handler to close expanded output
  const handleCloseExpanded = useCallback(() => {
    setIsOutputExpanded(false);
  }, []);

  // Copy output to clipboard
  const handleCopyOutput = useCallback(() => {
    if (rawOutput) {
      void navigator.clipboard.writeText(rawOutput);
      setHasCopied(true);
      setTimeout(() => setHasCopied(false), 2000);
    }
  }, []);

  // Format output for display
  // If output is an object with only an "output" key, unwrap it
  const unwrappedOutput = unwrapSingleOutputField(targetOutput.output);

  const rawOutput =
    unwrappedOutput === null || unwrappedOutput === undefined
      ? ""
      : typeof unwrappedOutput === "object"
        ? JSON.stringify(unwrappedOutput, null, 2)
        : String(unwrappedOutput);

  const isTruncated = rawOutput.length > MAX_DISPLAY_CHARS;
  const displayOutput = isTruncated
    ? rawOutput.slice(0, MAX_DISPLAY_CHARS)
    : rawOutput;

  // Use a simple heuristic to determine if content likely overflows
  // This avoids useEffect + scrollHeight measurement which causes flicker during virtualization
  const hasNewlines = rawOutput.includes("\n");
  const isLikelyOverflowing = rawOutput.length > OVERFLOW_CHAR_THRESHOLD || hasNewlines;

  // Render output content
  const renderOutput = (expanded: boolean) => {
    // Error state
    if (targetOutput.error) {
      return (
        <HStack
          gap={2}
          p={2}
          bg="red.50"
          borderRadius="md"
          color="red.700"
          fontSize="13px"
        >
          <Box flexShrink={0}>
            <LuCircleAlert size={16} />
          </Box>
          <Text lineClamp={expanded ? undefined : 2}>{targetOutput.error}</Text>
        </HStack>
      );
    }

    // Normal output
    if (displayOutput) {
      if (expanded) {
        return (
          <Box flex={1} overflowY="auto" minHeight={0}>
            <Text fontSize="13px" whiteSpace="pre-wrap" wordBreak="break-word">
              {displayOutput}
              {isTruncated && (
                <Box as="span" color="gray.400" fontSize="11px" marginLeft={1}>
                  (truncated)
                </Box>
              )}
            </Text>
          </Box>
        );
      }

      // Collapsed view - fills available row height, clips with fade if overflowing
      return (
        <Box
          position="relative"
          flex={1}
          minHeight={0}
          cursor={isLikelyOverflowing ? "pointer" : undefined}
          onClick={isLikelyOverflowing ? handleExpandOutput : undefined}
        >
          <Box
            height="100%"
            maxHeight={`${OUTPUT_MAX_HEIGHT}px`}
            overflow="hidden"
          >
            <Text fontSize="13px" whiteSpace="pre-wrap" wordBreak="break-word">
              {displayOutput}
              {isTruncated && (
                <Box as="span" color="gray.400" fontSize="11px" marginLeft={1}>
                  (truncated)
                </Box>
              )}
            </Text>
          </Box>

          {/* Fade overlay for overflowing content - shown based on heuristic to avoid flicker */}
          {isLikelyOverflowing && (
            <Box
              position="absolute"
              bottom={0}
              left="-12px"
              right="-12px"
              height="40px"
              cursor="pointer"
              onClick={handleExpandOutput}
              className="cell-fade-overlay"
              css={{
                background:
                  "linear-gradient(to bottom, transparent, white)",
                "tr:hover &": {
                  background:
                    "linear-gradient(to bottom, transparent, var(--chakra-colors-gray-50))",
                },
              }}
            />
          )}
        </Box>
      );
    }

    // No output
    return (
      <Text fontSize="13px" color="gray.400">
        No output
      </Text>
    );
  };

  // Render evaluator chips
  const renderEvaluatorChips = () => {
    if (targetOutput.evaluatorResults.length === 0) return null;

    return (
      <HStack flexWrap="wrap" gap={1.5}>
        {targetOutput.evaluatorResults.map((evalResult) => {
          // Convert BatchEvaluatorResult to the format expected by EvaluatorResultChip
          const result = {
            status: evalResult.status,
            score: evalResult.score,
            passed: evalResult.passed,
            label: evalResult.label,
            details: evalResult.details,
          };

          return (
            <EvaluatorResultChip
              key={evalResult.evaluatorId}
              name={evalResult.evaluatorName}
              result={result}
            />
          );
        })}
      </HStack>
    );
  };

  // Render action buttons (trace, copy, latency)
  const renderActionButtons = (inExpandedView: boolean) => (
    <HStack
      position="absolute"
      top={-1}
      right={-1}
      gap={0.5}
      zIndex={1}
      className={inExpandedView ? undefined : "cell-action-btn"}
      opacity={inExpandedView ? 1 : 0}
      transition="opacity 0.15s"
      bg="gray.50/90"
      borderRadius="md"
      px={0.5}
    >
      {/* Latency display */}
      {targetOutput.duration !== null && (
        <Tooltip
          content={`Latency: ${formatLatency(targetOutput.duration)}`}
          positioning={{ placement: "top" }}
          openDelay={100}
        >
          <Text
            fontSize="11px"
            color="gray.500"
            whiteSpace="nowrap"
            px={1}
            data-testid={`latency-${targetOutput.targetId}`}
          >
            {formatLatency(targetOutput.duration)}
          </Text>
        </Tooltip>
      )}
      {/* Trace link button */}
      {targetOutput.traceId && (
        <Tooltip
          content="View trace"
          positioning={{ placement: "top" }}
          openDelay={100}
        >
          <Button
            size="xs"
            variant="ghost"
            _hover={{ bg: "gray.200" }}
            onClick={handleViewTrace}
            data-testid={`trace-link-${targetOutput.targetId}`}
          >
            <LuListTree />
          </Button>
        </Tooltip>
      )}
      {/* Copy button */}
      {rawOutput && (
        <Tooltip
          content={hasCopied ? "Copied!" : "Copy to clipboard"}
          positioning={{ placement: "top" }}
          openDelay={100}
        >
          <Button
            size="xs"
            variant="ghost"
            _hover={{ bg: "gray.200" }}
            onClick={(e) => {
              e.stopPropagation();
              handleCopyOutput();
            }}
            data-testid={`copy-output-${targetOutput.targetId}`}
          >
            {hasCopied ? <LuCheck /> : <LuCopy />}
          </Button>
        </Tooltip>
      )}
    </HStack>
  );

  return (
    <>
      {/* Normal collapsed cell view */}
      <VStack
        ref={cellRef}
        position="relative"
        align="stretch"
        gap={2}
        height="100%"
        css={{ "&:hover .cell-action-btn": { opacity: 1 } }}
      >
        {renderActionButtons(false)}
        {renderOutput(false)}
        {renderEvaluatorChips()}
      </VStack>

      {/* Expanded cell overlay */}
      {isOutputExpanded && (
        <Portal>
          {/* Invisible backdrop to catch clicks outside */}
          <Box
            position="fixed"
            inset={0}
            zIndex={1000}
            onClick={handleCloseExpanded}
            data-testid="expanded-cell-backdrop"
          />
          {/* Expanded cell */}
          <Box
            position="fixed"
            top={`${expandedPosition.top - 12}px`}
            left={`${expandedPosition.left}px`}
            width={`${Math.max(expandedPosition.width, 250)}px`}
            maxHeight={`calc(100vh - ${expandedPosition.top - 12}px - 32px)`}
            overflowY="auto"
            bg="white/75"
            backdropFilter="blur(8px)"
            borderRadius="md"
            boxShadow="0 0 0 2px var(--chakra-colors-gray-300), 0 4px 12px rgba(0,0,0,0.15)"
            zIndex={1001}
            display="flex"
            flexDirection="column"
            p={3}
            css={{
              animation: "scale-in 0.15s ease-out",
            }}
          >
            <VStack align="stretch" gap={2} height="100%" position="relative">
              {renderActionButtons(true)}
              {renderOutput(true)}
              {renderEvaluatorChips()}
            </VStack>
          </Box>
        </Portal>
      )}
    </>
  );
}

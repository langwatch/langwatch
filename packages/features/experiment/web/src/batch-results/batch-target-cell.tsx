/**
 * BatchTargetCell - Displays a target's output and evaluator results in the batch results table
 *
 * This is a read-only version for displaying historical evaluation results.
 * For the interactive workbench version, see experiments-v3/components/TargetSection/target-cell.tsx
 */

import { Box, Button, HStack, Portal, Text, VStack } from "@chakra-ui/react";
import { type ReactNode, useCallback, useRef, useState } from "react";
import { LuCheck, LuCircleAlert, LuCopy, LuListTree } from "react-icons/lu";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { isTextLikelyOverflowing } from "@langwatch/design-system/text-overflow";
import {
  COLLAPSED_CELL_HEIGHT_PX,
  DEFAULT_ROW_HEIGHT,
  type RowHeight,
} from "./table-utils";
import {
  type DescribeBatchCellFailure,
  formatCost,
  formatLatency,
  formatTargetOutput,
  type RenderBatchEvaluatorResult,
  type RenderTracePeek,
  useEscapeKey,
} from "./presentation";
import type { BatchTargetOutput } from "../batch-evaluation-results.types";

// Max characters to display for performance
const MAX_DISPLAY_CHARS = 10000;

type BatchTargetCellProps = {
  /** Target output data for this row */
  targetOutput: BatchTargetOutput;
  /**
   * Evaluator ids we shouldn't render generic score chips for — comparison
   * evaluators surface via the dedicated Winner column (#5100 follow-up),
   * so their raw `label`+`score` chip (e.g. `target_XYZ 1.00`) reads as
   * duplicate noise and confused users during dogfooding. The Set is the
   * single source of truth passed down from the transform step.
   */
  suppressedEvaluatorIds?: Set<string>;
  /** Whether to render the target's output (default true) */
  showOutput?: boolean;
  /** Whether to render the evaluator score chips (default true) */
  showEvaluations?: boolean;
  /** Whether to render the cost/latency readout (default true) */
  showCostAndLatency?: boolean;
  /** How much of the collapsed output to show before it needs expanding */
  rowHeight?: RowHeight;
  describeFailure?: DescribeBatchCellFailure;
  renderEvaluatorResult?: RenderBatchEvaluatorResult;
  renderTracePeek?: RenderTracePeek;
  onOpenTrace?: (traceId: string) => void;
};

/** A single cost/latency readout in the action bar — same tooltip + text shell either way. */
const MetricBadge = ({
  testId,
  tooltipLabel,
  children,
}: {
  testId: string;
  tooltipLabel: string;
  children: ReactNode;
}) => (
  <Tooltip content={tooltipLabel} positioning={{ placement: "top" }} openDelay={100}>
    <Text
      fontSize="11px"
      color="fg.muted"
      whiteSpace="nowrap"
      px={1}
      data-testid={testId}
    >
      {children}
    </Text>
  </Tooltip>
);

export function BatchTargetCell({
  targetOutput,
  suppressedEvaluatorIds,
  showOutput = true,
  showEvaluations = true,
  showCostAndLatency = true,
  rowHeight = DEFAULT_ROW_HEIGHT,
  describeFailure,
  renderEvaluatorResult,
  renderTracePeek,
  onOpenTrace,
}: BatchTargetCellProps) {
  const outputMaxHeight = COLLAPSED_CELL_HEIGHT_PX[rowHeight];

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
    onOpenTrace?.(targetOutput.traceId);
  }, [onOpenTrace, targetOutput.traceId]);

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

  useEscapeKey({ enabled: isOutputExpanded, onEscape: handleCloseExpanded });

  // Copy output to clipboard
  const handleCopyOutput = useCallback(() => {
    if (rawOutput) {
      void navigator.clipboard.writeText(rawOutput);
      setHasCopied(true);
      setTimeout(() => setHasCopied(false), 2000);
    }
  }, []);

  // Use shared utility for consistent output formatting
  // Handles the "single output key" unwrap rule:
  // - {output: "hello"} -> "hello"
  // - {pizza: false} -> '{"pizza": false}' (formatted JSON)
  const rawOutput = formatTargetOutput(targetOutput.output);

  const isTruncated = rawOutput.length > MAX_DISPLAY_CHARS;
  const displayOutput = isTruncated ? rawOutput.slice(0, MAX_DISPLAY_CHARS) : rawOutput;

  // Use a heuristic to determine if content likely overflows
  // This avoids useEffect + scrollHeight measurement which causes flicker during virtualization
  const isLikelyOverflowing = isTextLikelyOverflowing(rawOutput);

  const failure =
    describeFailure?.({
      error: targetOutput.error,
      domainError: targetOutput.domainError,
    }) ??
    (targetOutput.error
      ? { title: targetOutput.error, description: "", raw: targetOutput.error }
      : null);

  // Render output content
  const renderOutput = (expanded: boolean) => {
    // Error state
    if (failure) {
      const errorBox = (
        <HStack
          gap={2}
          p={2}
          bg="red.subtle"
          borderRadius="md"
          color="red.fg"
          fontSize="13px"
          cursor={expanded ? undefined : "pointer"}
          onClick={expanded ? undefined : handleExpandOutput}
          data-testid={`error-output-${targetOutput.targetId}`}
        >
          <Box flexShrink={0}>
            <LuCircleAlert size={16} />
          </Box>
          <VStack align="start" gap={0.5}>
            <Text lineClamp={expanded ? undefined : 2}>{failure.title}</Text>
            {failure.description && (
              <Text fontSize="12px" color="fg.muted" lineClamp={expanded ? undefined : 2}>
                {failure.description}
              </Text>
            )}
          </VStack>
        </HStack>
      );

      // The cell clamps to two lines, so the full error is hidden. Surface it
      // on hover (and on click via the expanded overlay above) instead of
      // forcing the user to inspect the DOM. The engine's own words ride along
      // here, marked as detail — this is the "on request" surface, not copy.
      if (expanded) {
        return errorBox;
      }

      return (
        <Tooltip
          content={
            <VStack
              align="start"
              gap={1}
              data-testid={`error-tooltip-${targetOutput.targetId}`}
            >
              <Text fontSize="13px" whiteSpace="pre-wrap" wordBreak="break-word">
                {failure.description
                  ? `${failure.title}. ${failure.description}`
                  : failure.title}
              </Text>
              {failure.raw && (
                <Text
                  fontSize="12px"
                  opacity={0.8}
                  whiteSpace="pre-wrap"
                  wordBreak="break-word"
                >
                  {failure.raw}
                </Text>
              )}
            </VStack>
          }
          positioning={{ placement: "top" }}
          openDelay={100}
          contentProps={{ maxWidth: "480px" }}
        >
          {errorBox}
        </Tooltip>
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
                <Box as="span" color="fg.subtle" fontSize="11px" marginLeft={1}>
                  (truncated)
                </Box>
              )}
            </Text>
          </Box>
        );
      }

      // Collapsed view with fade
      return (
        <Box position="relative">
          <Box
            maxHeight={`${outputMaxHeight}px`}
            data-row-height={rowHeight}
            overflow="hidden"
            cursor={isLikelyOverflowing ? "pointer" : undefined}
            onClick={isLikelyOverflowing ? handleExpandOutput : undefined}
          >
            <Text fontSize="13px" whiteSpace="pre-wrap" wordBreak="break-word">
              {displayOutput}
              {isTruncated && (
                <Box as="span" color="fg.subtle" fontSize="11px" marginLeft={1}>
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
                  "linear-gradient(to bottom, transparent, var(--chakra-colors-bg-panel))",
                "tr:hover &": {
                  background:
                    "linear-gradient(to bottom, transparent, var(--chakra-colors-bg-muted))",
                },
              }}
            />
          )}
        </Box>
      );
    }

    // No output
    return (
      <Text fontSize="13px" color="fg.subtle">
        No output
      </Text>
    );
  };

  // Render evaluator chips
  const renderEvaluatorChips = () => {
    const visibleResults = suppressedEvaluatorIds
      ? targetOutput.evaluatorResults.filter(
          (r) => !suppressedEvaluatorIds.has(r.evaluatorId),
        )
      : targetOutput.evaluatorResults;
    if (visibleResults.length === 0) return null;

    return (
      <HStack flexWrap="wrap" gap={1.5}>
        {visibleResults.map((evalResult) => {
          return renderEvaluatorResult ? (
            <Box key={evalResult.evaluatorId}>
              {renderEvaluatorResult({ result: evalResult })}
            </Box>
          ) : (
            <HStack key={evalResult.evaluatorId} gap={1} fontSize="11px" color="fg.muted">
              <Text>{evalResult.evaluatorName}</Text>
              {evalResult.score !== null && evalResult.score !== undefined && (
                <Text fontWeight="semibold">{evalResult.score.toFixed(2)}</Text>
              )}
            </HStack>
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
      bg="bg.subtle/90"
      borderRadius="md"
      px={0.5}
    >
      {/* Cost display */}
      {showCostAndLatency && targetOutput.cost !== null && (
        <MetricBadge
          testId={`cost-${targetOutput.targetId}`}
          tooltipLabel={`Cost: ${formatCost(targetOutput.cost)}`}
        >
          {formatCost(targetOutput.cost)}
        </MetricBadge>
      )}
      {/* Latency display */}
      {showCostAndLatency && targetOutput.duration !== null && (
        <MetricBadge
          testId={`latency-${targetOutput.targetId}`}
          tooltipLabel={`Latency: ${formatLatency(targetOutput.duration)}`}
        >
          {formatLatency(targetOutput.duration)}
        </MetricBadge>
      )}
      {/* Trace link button */}
      {showOutput && targetOutput.traceId && onOpenTrace && (
        <Tooltip content="View trace" positioning={{ placement: "top" }} openDelay={100}>
          <Button
            size="xs"
            variant="ghost"
            _hover={{ bg: "bg.emphasized" }}
            onClick={handleViewTrace}
            data-testid={`trace-link-${targetOutput.targetId}`}
          >
            <LuListTree />
          </Button>
        </Tooltip>
      )}
      {showOutput &&
        targetOutput.traceId &&
        renderTracePeek?.({ traceId: targetOutput.traceId })}
      {/* Copy button */}
      {showOutput && rawOutput && (
        <Tooltip
          content={hasCopied ? "Copied!" : "Copy to clipboard"}
          positioning={{ placement: "top" }}
          openDelay={100}
        >
          <Button
            size="xs"
            variant="ghost"
            _hover={{ bg: "bg.emphasized" }}
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
        css={{ "&:hover .cell-action-btn": { opacity: 1 } }}
      >
        {(showOutput || showCostAndLatency) && renderActionButtons(false)}
        {showOutput && renderOutput(false)}
        {showEvaluations && renderEvaluatorChips()}
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
            bg="bg.panel/75"
            backdropFilter="blur(8px)"
            borderRadius="md"
            boxShadow="0 0 0 2px var(--chakra-colors-border-emphasized), 0 4px 12px rgba(0,0,0,0.15)"
            zIndex={1001}
            display="flex"
            flexDirection="column"
            p={3}
            css={{
              animation: "scale-in 0.15s ease-out",
            }}
          >
            <VStack align="stretch" gap={2} height="100%" position="relative">
              {(showOutput || showCostAndLatency) && renderActionButtons(true)}
              {showOutput && renderOutput(true)}
              {showEvaluations && renderEvaluatorChips()}
            </VStack>
          </Box>
        </Portal>
      )}
    </>
  );
}

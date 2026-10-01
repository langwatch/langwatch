/**
 * BatchTargetCell - Displays a target's output and evaluator results in the batch
 * results table
 */

import { formatCost } from "@langwatch/design-system/metric-value-formatters";
import { Box, Button, HStack, Portal, Text, VStack } from "@langwatch/design-system/primitives";
import { isTextLikelyOverflowing } from "@langwatch/design-system/text-overflow";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { type ReactNode, useCallback, useRef, useState } from "react";
import { LuCheck, LuCircleAlert, LuCopy, LuListTree } from "react-icons/lu";

import { formatTargetOutput } from "../../../model/format-target-output.ts";
import type { BatchEvaluatorResult, BatchTargetOutput } from "../batch-evaluation-results.types.ts";
import {
  type BatchCellFailure,
  type DescribeBatchCellFailure,
  formatLatency,
  type RenderBatchEvaluatorResult,
  type RenderTracePeek,
  useEscapeKey,
} from "./presentation.tsx";
import { COLLAPSED_CELL_HEIGHT_PX, DEFAULT_ROW_HEIGHT, type RowHeight } from "./table-utils.ts";

// Max characters to display for performance
const MAX_DISPLAY_CHARS = 10000;

type BatchTargetCellProps = {
  /** Target output data for this row */
  targetOutput: BatchTargetOutput;
  // Evaluator ids to skip (comparison evaluators show in Winner column)
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
    <Text fontSize="11px" color="fg.muted" whiteSpace="nowrap" px={1} data-testid={testId}>
      {children}
    </Text>
  </Tooltip>
);

const cellFailureOf = ({
  targetOutput,
  describeFailure,
}: {
  targetOutput: BatchTargetOutput;
  describeFailure?: DescribeBatchCellFailure;
}): BatchCellFailure | null => {
  const described = describeFailure?.({
    error: targetOutput.error,
    domainError: targetOutput.domainError,
  });
  if (described) return described;
  const { error } = targetOutput;
  return error ? { title: error, description: "", raw: error } : null;
};

/**
 * Where the expanded overlay opens: over this value's own position (a diff-mode td holds
 * several values), at least the td's width, and pulled left rather than past the viewport.
 */
const expandedPositionOf = (cell: HTMLDivElement) => {
  const rect = cell.getBoundingClientRect();
  const tdWidth = cell.closest("td")?.getBoundingClientRect().width ?? rect.width;
  const width = Math.max(rect.width, tdWidth) + 24;
  const safetyMargin = 32;
  const maxLeft = window.innerWidth - width - safetyMargin;
  return { top: rect.top, left: Math.min(rect.left - 12, maxLeft), width };
};

const useExpandedCell = () => {
  const [isExpanded, setIsExpanded] = useState(false);
  const cellRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0 });
  const expand = useCallback(() => {
    if (cellRef.current) setPosition(expandedPositionOf(cellRef.current));
    setIsExpanded(true);
  }, []);
  const close = useCallback(() => setIsExpanded(false), []);
  useEscapeKey({ enabled: isExpanded, onEscape: close });
  return { cellRef, isExpanded, position, expand, close };
};

const useCopyText = (text: string) => {
  const [hasCopied, setHasCopied] = useState(false);
  const copy = useCallback(() => {
    if (!text) return;
    void navigator.clipboard.writeText(text);
    setHasCopied(true);
    setTimeout(() => setHasCopied(false), 2000);
  }, [text]);
  return { hasCopied, copy };
};

/**
 * The cell clamps to two lines, so the full error shows on hover (and on click through the
 * expanded overlay). The engine's own words ride along as detail: this is the on-request
 * surface. A describer with nothing better to say repeats the title as `raw`; show it once.
 */
const CellFailure = ({
  failure,
  expanded,
  targetId,
  onExpand,
}: {
  failure: BatchCellFailure;
  expanded: boolean;
  targetId: string;
  onExpand: () => void;
}) => {
  const errorBox = (
    <HStack
      gap={2}
      p={2}
      bg="red.subtle"
      borderRadius="md"
      color="red.fg"
      fontSize="13px"
      cursor={expanded ? undefined : "pointer"}
      onClick={expanded ? undefined : onExpand}
      data-testid={`error-output-${targetId}`}
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
  if (expanded) return errorBox;

  return (
    <Tooltip
      content={
        <VStack align="start" gap={1} data-testid={`error-tooltip-${targetId}`}>
          <Text fontSize="13px" whiteSpace="pre-wrap" wordBreak="break-word">
            {failure.description ? `${failure.title}. ${failure.description}` : failure.title}
          </Text>
          {failure.raw && failure.raw !== failure.title && (
            <Text fontSize="12px" opacity={0.8} whiteSpace="pre-wrap" wordBreak="break-word">
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
};

const OutputText = ({ text, isTruncated }: { text: string; isTruncated: boolean }) => (
  <Text fontSize="13px" whiteSpace="pre-wrap" wordBreak="break-word">
    {text}
    {isTruncated && (
      <Box as="span" color="fg.subtle" fontSize="11px" marginLeft={1}>
        (truncated)
      </Box>
    )}
  </Text>
);

/**
 * The collapsed output, faded when it likely overflows: a heuristic rather than a
 * scrollHeight measurement, which flickers under virtualization.
 */
const CollapsedOutput = ({
  output,
  rowHeight,
  onExpand,
}: {
  output: string;
  rowHeight: RowHeight;
  onExpand: () => void;
}) => {
  const isTruncated = output.length > MAX_DISPLAY_CHARS;
  const isLikelyOverflowing = isTextLikelyOverflowing(output);
  return (
    <Box position="relative">
      <Box
        maxHeight={`${COLLAPSED_CELL_HEIGHT_PX[rowHeight]}px`}
        data-row-height={rowHeight}
        overflow="hidden"
        cursor={isLikelyOverflowing ? "pointer" : undefined}
        onClick={isLikelyOverflowing ? onExpand : undefined}
      >
        <OutputText text={output.slice(0, MAX_DISPLAY_CHARS)} isTruncated={isTruncated} />
      </Box>
      {isLikelyOverflowing && (
        <Box
          position="absolute"
          bottom={0}
          left="-12px"
          right="-12px"
          height="40px"
          cursor="pointer"
          onClick={onExpand}
          className="cell-fade-overlay"
          css={{
            background: "linear-gradient(to bottom, transparent, var(--chakra-colors-bg-panel))",
            "tr:hover &": {
              background: "linear-gradient(to bottom, transparent, var(--chakra-colors-bg-muted))",
            },
          }}
        />
      )}
    </Box>
  );
};

type CellOutputProps = {
  failure: BatchCellFailure | null;
  output: string;
  targetId: string;
  expanded: boolean;
  rowHeight: RowHeight;
  onExpand: () => void;
};

const CellOutput = ({
  failure,
  output,
  targetId,
  expanded,
  rowHeight,
  onExpand,
}: CellOutputProps) => {
  if (failure) {
    return (
      <CellFailure failure={failure} expanded={expanded} targetId={targetId} onExpand={onExpand} />
    );
  }
  if (!output) {
    return (
      <Text fontSize="13px" color="fg.subtle">
        No output
      </Text>
    );
  }
  if (!expanded)
    return <CollapsedOutput output={output} rowHeight={rowHeight} onExpand={onExpand} />;
  return (
    <Box flex={1} overflowY="auto" minHeight={0}>
      <OutputText
        text={output.slice(0, MAX_DISPLAY_CHARS)}
        isTruncated={output.length > MAX_DISPLAY_CHARS}
      />
    </Box>
  );
};

const EvaluatorChip = ({
  result,
  renderEvaluatorResult,
}: {
  result: BatchEvaluatorResult;
  renderEvaluatorResult?: RenderBatchEvaluatorResult;
}) => {
  if (renderEvaluatorResult) return <Box>{renderEvaluatorResult({ result })}</Box>;
  return (
    <HStack gap={1} fontSize="11px" color="fg.muted">
      <Text>{result.evaluatorName}</Text>
      {result.score !== null && result.score !== undefined && (
        <Text fontWeight="semibold">{result.score.toFixed(2)}</Text>
      )}
    </HStack>
  );
};

const EvaluatorChips = ({
  results,
  suppressedEvaluatorIds,
  renderEvaluatorResult,
}: {
  results: BatchEvaluatorResult[];
  suppressedEvaluatorIds?: Set<string>;
  renderEvaluatorResult?: RenderBatchEvaluatorResult;
}) => {
  const visibleResults = results.filter((r) => !suppressedEvaluatorIds?.has(r.evaluatorId));
  if (visibleResults.length === 0) return null;
  return (
    <HStack flexWrap="wrap" gap={1.5}>
      {visibleResults.map((result) => (
        <EvaluatorChip
          key={result.evaluatorId}
          result={result}
          renderEvaluatorResult={renderEvaluatorResult}
        />
      ))}
    </HStack>
  );
};

const CostAndLatency = ({ targetOutput }: { targetOutput: BatchTargetOutput }) => (
  <>
    {targetOutput.cost !== null && (
      <MetricBadge
        testId={`cost-${targetOutput.targetId}`}
        tooltipLabel={`Cost: ${formatCost(targetOutput.cost)}`}
      >
        {formatCost(targetOutput.cost)}
      </MetricBadge>
    )}
    {targetOutput.duration !== null && (
      <MetricBadge
        testId={`latency-${targetOutput.targetId}`}
        tooltipLabel={`Latency: ${formatLatency(targetOutput.duration)}`}
      >
        {formatLatency(targetOutput.duration)}
      </MetricBadge>
    )}
  </>
);

const TraceActions = ({
  traceId,
  targetId,
  onViewTrace,
  onOpenTrace,
  renderTracePeek,
}: {
  traceId: string;
  targetId: string;
  onViewTrace: () => void;
  onOpenTrace?: (traceId: string) => void;
  renderTracePeek?: RenderTracePeek;
}) => (
  <>
    {onOpenTrace && (
      <Tooltip content="View trace" positioning={{ placement: "top" }} openDelay={100}>
        <Button
          size="xs"
          variant="ghost"
          _hover={{ bg: "bg.emphasized" }}
          onClick={onViewTrace}
          data-testid={`trace-link-${targetId}`}
        >
          <LuListTree />
        </Button>
      </Tooltip>
    )}
    {renderTracePeek?.({ traceId })}
  </>
);

const CopyButton = ({
  targetId,
  hasCopied,
  onCopy,
}: {
  targetId: string;
  hasCopied: boolean;
  onCopy: () => void;
}) => (
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
        onCopy();
      }}
      data-testid={`copy-output-${targetId}`}
    >
      {hasCopied ? <LuCheck /> : <LuCopy />}
    </Button>
  </Tooltip>
);

type CellBodyProps = Omit<BatchTargetCellProps, "rowHeight" | "describeFailure"> & {
  expanded: boolean;
  rowHeight: RowHeight;
  failure: BatchCellFailure | null;
  output: string;
  hasCopied: boolean;
  onCopy: () => void;
  onExpand: () => void;
  onViewTrace: () => void;
};

/** The cell's contents, shared by the collapsed cell and its expanded overlay. */
const CellBody = (props: CellBodyProps) => {
  const { targetOutput, expanded, showOutput, showEvaluations, showCostAndLatency } = props;
  const traceId = showOutput ? targetOutput.traceId : null;
  return (
    <>
      {(showOutput || showCostAndLatency) && (
        <HStack
          position="absolute"
          top={-1}
          right={-1}
          gap={0.5}
          zIndex={1}
          className={expanded ? undefined : "cell-action-btn"}
          opacity={expanded ? 1 : 0}
          transition="opacity 0.15s"
          bg="bg.subtle/90"
          borderRadius="md"
          px={0.5}
        >
          {showCostAndLatency && <CostAndLatency targetOutput={targetOutput} />}
          {traceId && (
            <TraceActions
              traceId={traceId}
              targetId={targetOutput.targetId}
              onViewTrace={props.onViewTrace}
              onOpenTrace={props.onOpenTrace}
              renderTracePeek={props.renderTracePeek}
            />
          )}
          {showOutput && props.output && (
            <CopyButton
              targetId={targetOutput.targetId}
              hasCopied={props.hasCopied}
              onCopy={props.onCopy}
            />
          )}
        </HStack>
      )}
      {showOutput && (
        <CellOutput
          failure={props.failure}
          output={props.output}
          targetId={targetOutput.targetId}
          expanded={expanded}
          rowHeight={props.rowHeight}
          onExpand={props.onExpand}
        />
      )}
      {showEvaluations && (
        <EvaluatorChips
          results={targetOutput.evaluatorResults}
          suppressedEvaluatorIds={props.suppressedEvaluatorIds}
          renderEvaluatorResult={props.renderEvaluatorResult}
        />
      )}
    </>
  );
};

export function BatchTargetCell({
  targetOutput,
  showOutput = true,
  showEvaluations = true,
  showCostAndLatency = true,
  rowHeight = DEFAULT_ROW_HEIGHT,
  describeFailure,
  onOpenTrace,
  ...rest
}: BatchTargetCellProps) {
  const { cellRef, isExpanded, position, expand, close } = useExpandedCell();
  // {output: "hello"} reads "hello"; {pizza: false} reads as formatted JSON.
  const output = formatTargetOutput(targetOutput.output);
  const { hasCopied, copy } = useCopyText(output);

  const handleViewTrace = useCallback(() => {
    if (!targetOutput.traceId) return;
    close();
    onOpenTrace?.(targetOutput.traceId);
  }, [onOpenTrace, targetOutput.traceId, close]);

  const body = {
    ...rest,
    targetOutput,
    showOutput,
    showEvaluations,
    showCostAndLatency,
    rowHeight,
    onOpenTrace,
    failure: cellFailureOf({ targetOutput, describeFailure }),
    output,
    hasCopied,
    onCopy: copy,
    onExpand: expand,
    onViewTrace: handleViewTrace,
  };

  return (
    <>
      <VStack
        ref={cellRef}
        position="relative"
        align="stretch"
        gap={2}
        css={{ "&:hover .cell-action-btn": { opacity: 1 } }}
      >
        <CellBody {...body} expanded={false} />
      </VStack>

      {isExpanded && (
        <Portal>
          {/* Invisible backdrop to catch clicks outside */}
          <Box
            position="fixed"
            inset={0}
            zIndex={1000}
            onClick={close}
            data-testid="expanded-cell-backdrop"
          />
          <Box
            position="fixed"
            top={`${position.top - 12}px`}
            left={`${position.left}px`}
            width={`${Math.max(position.width, 250)}px`}
            maxHeight={`calc(100vh - ${position.top - 12}px - 32px)`}
            overflowY="auto"
            bg="bg.panel/75"
            backdropFilter="blur(8px)"
            borderRadius="md"
            boxShadow="0 0 0 2px var(--chakra-colors-border-emphasized), 0 4px 12px rgba(0,0,0,0.15)"
            zIndex={1001}
            display="flex"
            flexDirection="column"
            p={3}
            css={{ animation: "scale-in 0.15s ease-out" }}
          >
            <VStack align="stretch" gap={2} height="100%" position="relative">
              <CellBody {...body} expanded={true} />
            </VStack>
          </Box>
        </Portal>
      )}
    </>
  );
}

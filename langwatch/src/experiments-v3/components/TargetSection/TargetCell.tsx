import {
  Box,
  Button,
  HStack,
  Portal,
  Skeleton,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  LuCheck,
  LuCircleAlert,
  LuCopy,
  LuListTree,
  LuPlay,
  LuPlus,
  LuSquare,
} from "react-icons/lu";
import { Tooltip } from "~/components/ui/tooltip";
import { TraceIdPeek } from "~/features/traces-v2/components/TraceIdPeek";
import { useDrawer } from "~/hooks/useDrawer";
import { parseEvaluationResult } from "~/utils/evaluationResults";
import { parseLLMError } from "~/utils/formatLLMError";
import { formatTargetOutput } from "~/utils/formatTargetOutput";
import { useEvaluationsV3Store } from "../../hooks/useEvaluationsV3Store";
import { useCodeEvaluatorIds } from "../../hooks/useEvaluatorName";
import { useOpenEvaluatorEditor } from "../../hooks/useOpenEvaluatorEditor";
import { useTargetName } from "../../hooks/useTargetName";
import type { EvaluatorConfig, TargetConfig } from "../../types";
import {
  formatLatency,
  normalizePairwiseLabel,
} from "../../utils/computeAggregates";
import { evaluatorHasMissingMappings } from "../../utils/mappingValidation";
import { PairwiseVerdictRow } from "../PairwiseVerdictRow";
import { EvaluatorChip } from "../TargetSection/EvaluatorChip";

// Max characters to display for performance reasons
const MAX_DISPLAY_CHARS = 10000;

// Max height for the output content before showing fade (in collapsed mode)
const OUTPUT_MAX_HEIGHT = 120;

type TargetCellContentProps = {
  target: TargetConfig;
  output: unknown;
  evaluatorResults: Record<string, unknown>;
  row: number;
  /** Error message for this cell (from results.errors) */
  error?: string | null;
  /** Whether this cell is currently being executed */
  isLoading?: boolean;
  /** Trace ID for this execution (if available) */
  traceId?: string | null;
  /** Duration/latency for this execution in milliseconds */
  duration?: number | null;
  /** Check if a specific evaluator is currently running */
  isEvaluatorRunning?: (evaluatorId: string) => boolean;
  onAddEvaluator?: () => void;
  /** Handler for running this specific cell */
  onRunCell?: () => void;
  /** Handler for stopping execution */
  onStopCell?: () => void;
  /** Handler for re-running a specific evaluator on this cell */
  onRerunEvaluator?: (evaluatorId: string) => void;
  /** Handler for running an evaluator on all rows with target outputs */
  onRunEvaluatorOnAllRows?: (evaluatorId: string) => void;
  /** Whether any row has a target output for this target */
  hasAnyTargetOutputs?: boolean;
};

export function TargetCellContent({
  target,
  output,
  evaluatorResults,
  error,
  isLoading,
  traceId,
  duration,
  isEvaluatorRunning,
  onAddEvaluator,
  onRunCell,
  onStopCell,
  onRerunEvaluator,
  onRunEvaluatorOnAllRows,
  hasAnyTargetOutputs,
}: TargetCellContentProps) {
  const { openDrawer } = useDrawer();
  const targetName = useTargetName(target);
  const openEvaluatorEditor = useOpenEvaluatorEditor();
  const { evaluators, targets, activeDatasetId, removeEvaluator } =
    useEvaluationsV3Store((state) => ({
      evaluators: state.evaluators,
      targets: state.targets,
      activeDatasetId: state.activeDatasetId,
      removeEvaluator: state.removeEvaluator,
    }));

  // Code evaluators (DB type "code") route their edit flow to the code editor.
  const codeEvaluatorIds = useCodeEvaluatorIds(evaluators);

  // State for expanded output view
  const [isOutputExpanded, setIsOutputExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [hasCopied, setHasCopied] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);
  const cellRef = useRef<HTMLDivElement>(null);
  const [expandedPosition, setExpandedPosition] = useState({
    top: 0,
    left: 0,
    width: 0,
  });

  // State for expanded error view
  const [isErrorExpanded, setIsErrorExpanded] = useState(false);

  // Check if content overflows
  useEffect(() => {
    if (outputRef.current) {
      const isContentOverflowing =
        outputRef.current.scrollHeight > OUTPUT_MAX_HEIGHT;
      setIsOverflowing(isContentOverflowing);
    }
  }, [output]);

  // Check if error is likely to overflow 2 lines (~100 chars is a rough heuristic)
  const isErrorOverflowing = (error?.length ?? 0) > 100;

  // Handler to open trace drawer (also closes expanded view)
  const handleViewTrace = useCallback(() => {
    if (!traceId) return;
    setIsOutputExpanded(false);
    openDrawer("traceDetails", { traceId });
  }, [traceId, openDrawer]);

  // Handler to expand output
  const handleExpandOutput = useCallback(() => {
    if (cellRef.current) {
      // Get the parent td element for proper positioning (same as dataset cells)
      const td = cellRef.current.closest("td");
      if (td) {
        const rect = td.getBoundingClientRect();
        setExpandedPosition({
          top: rect.top,
          left: rect.left,
          width: rect.width,
        });
      }
    }
    setIsOutputExpanded(true);
  }, []);

  // Handler to close expanded output
  const handleCloseExpanded = useCallback(() => {
    setIsOutputExpanded(false);
  }, []);

  // Calculate which evaluators have missing mappings for this target
  const missingMappingsSet = useMemo(() => {
    const missing = new Set<string>();
    for (const evaluator of evaluators) {
      if (evaluatorHasMissingMappings(evaluator, activeDatasetId, target.id)) {
        missing.add(evaluator.id);
      }
    }
    return missing;
  }, [evaluators, activeDatasetId, target.id]);

  // Use shared utility for consistent output formatting
  // Handles the "single output key" unwrap rule:
  // - {output: "hello"} -> "hello"
  // - {pizza: false} -> '{"pizza": false}' (formatted JSON)
  const rawOutput = formatTargetOutput(output);

  // Truncate for performance (but keep full text for expanded view)
  const isTruncated = rawOutput.length > MAX_DISPLAY_CHARS;
  const displayOutput = isTruncated
    ? rawOutput.slice(0, MAX_DISPLAY_CHARS)
    : rawOutput;

  // Render output content - can be collapsed or expanded
  const renderOutput = (expanded: boolean) => {
    // Loading state - show skeleton whenever this cell is being executed
    // This includes re-running cells that already have content
    if (isLoading) {
      return (
        <VStack align="stretch" gap={1}>
          <Skeleton height="14px" width="80%" />
          <Skeleton height="14px" width="60%" />
        </VStack>
      );
    }

    // Error state - show error message
    if (error) {
      return (
        <Box position="relative">
          <HStack
            gap={2}
            p={2}
            bg="red.subtle"
            borderRadius="md"
            color="red.fg"
            fontSize="13px"
            align="start"
            cursor={
              isErrorOverflowing && !isErrorExpanded ? "pointer" : undefined
            }
            onClick={() => setIsErrorExpanded(true)}
            onDoubleClick={
              isErrorOverflowing ? () => setIsErrorExpanded(false) : undefined
            }
          >
            <Box flexShrink={0} paddingTop={0.5}>
              <LuCircleAlert size={16} />
            </Box>
            <Text
              lineClamp={expanded || isErrorExpanded ? undefined : 2}
              userSelect="text"
              whiteSpace="pre-wrap"
              wordBreak="break-word"
            >
              {parseLLMError(error).message}
            </Text>
          </HStack>
        </Box>
      );
    }

    // Normal output - with fade effect when collapsed, scrollable when expanded
    if (displayOutput) {
      if (expanded) {
        // Expanded view - scrollable, no max height
        return (
          <VStack flex={1} overflowY="auto" minHeight={0} align="start">
            <Text
              fontSize="11px"
              color="fg.muted"
              fontWeight="700"
              textTransform="uppercase"
            >
              Output
            </Text>
            <Text fontSize="13px" whiteSpace="pre-wrap" wordBreak="break-word">
              {displayOutput}
              {isTruncated && (
                <Box as="span" color="fg.subtle" fontSize="11px" marginLeft={1}>
                  (truncated)
                </Box>
              )}
            </Text>
          </VStack>
        );
      }

      // Collapsed view - with max-height and fade
      return (
        <Box position="relative">
          <VStack
            ref={outputRef}
            maxHeight={`${OUTPUT_MAX_HEIGHT}px`}
            overflow="hidden"
            cursor={isOverflowing ? "pointer" : undefined}
            onClick={isOverflowing ? handleExpandOutput : undefined}
            align="start"
          >
            <Text fontSize="13px" whiteSpace="pre-wrap" wordBreak="break-word">
              {displayOutput}
              {isTruncated && (
                <Box as="span" color="fg.subtle" fontSize="11px" marginLeft={1}>
                  (truncated)
                </Box>
              )}
            </Text>
          </VStack>

          {/* Fade overlay for overflowing content */}
          {isOverflowing && (
            <Box
              position="absolute"
              bottom={0}
              left={"-10px"}
              right={"-10px"}
              height="40px"
              cursor="pointer"
              onClick={handleExpandOutput}
              className="cell-fade-overlay"
              css={{
                background:
                  "linear-gradient(to bottom, transparent, var(--chakra-colors-bg-panel))",
                "tr:hover &": {
                  background:
                    "linear-gradient(to bottom, transparent, var(--chakra-colors-bg-subtle))",
                },
                // Selected row takes priority over hover
                "tr[data-selected='true'] &": {
                  background:
                    "linear-gradient(to bottom, transparent, var(--chakra-colors-blue-subtle))",
                },
              }}
            />
          )}
        </Box>
      );
    }

    // No output yet
    return (
      <Text fontSize="13px" color="fg.subtle">
        No output yet
      </Text>
    );
  };

  // Render any pairwise verdict strips for this row (#5100). Rendered only
  // when `target` is the variantA of a pairwise evaluator so we get one
  // strip per row, not duplicated under variantB. The verdict result lives
  // at `evaluatorResults[evaluator.id]` because the orchestrator anchors
  // the Phase-2 cell on variantA. Normalization of the stored label
  // (which is now the winner's candidate id, not a slot letter) happens
  // inside PairwiseVerdictRow — it has access to `useTargetName` for both
  // variants, which is required to match handle-shaped labels.
  const renderPairwiseVerdicts = () => {
    const strips: ReactNode[] = [];
    for (const evaluator of evaluators) {
      const pw = evaluator.pairwise;
      if (!pw) continue;
      if (pw.variantA !== target.id) continue;
      const parsed = parseEvaluationResult(evaluatorResults[evaluator.id]);
      if (parsed.status !== "processed") continue;
      if (typeof parsed.label !== "string") continue;
      const variantBTarget = targets.find((t) => t.id === pw.variantB);
      if (!variantBTarget) continue;
      strips.push(
        <PairwiseVerdictRow
          key={evaluator.id}
          variantA={target}
          variantB={variantBTarget}
          label={parsed.label}
          reasoning={parsed.details}
        />,
      );
    }
    return strips.length > 0 ? <>{strips}</> : null;
  };

  // Render the evaluator chips section. Pairwise-typed evaluators route
  // through PairwiseAwareEvaluatorChip so the chip-tint can resolve the
  // winner-by-id label format against each variant's prompt handle (the
  // resolution needs `useTargetName`, which is a hook and so cannot live
  // in `evaluators.map`).
  const renderEvaluatorChips = (inExpandedView: boolean) => (
    <HStack flexWrap="wrap" gap={1.5}>
      {evaluators.map((evaluator: EvaluatorConfig) => {
        const chipProps = {
          evaluator,
          result: evaluatorResults[evaluator.id],
          hasMissingMappings: missingMappingsSet.has(evaluator.id),
          isRunning: isEvaluatorRunning?.(evaluator.id) ?? false,
          hasTargetOutput: output !== undefined && output !== null,
          hasAnyTargetOutputs,
          targetType: target.type,
          onEdit: () =>
            openEvaluatorEditor({
              evaluator,
              target,
              targetName,
              isCodeEvaluator: codeEvaluatorIds.has(evaluator.id),
            }),
          onRemove: () => removeEvaluator(evaluator.id),
          onRerun: onRerunEvaluator
            ? () => onRerunEvaluator(evaluator.id)
            : undefined,
          onRunOnAllRows: onRunEvaluatorOnAllRows
            ? () => onRunEvaluatorOnAllRows(evaluator.id)
            : undefined,
        };
        if (evaluator.pairwise) {
          return (
            <PairwiseAwareEvaluatorChip
              key={evaluator.id}
              target={target}
              targets={targets}
              result={evaluatorResults[evaluator.id]}
              chipProps={chipProps}
            />
          );
        }
        return <EvaluatorChip key={evaluator.id} {...chipProps} />;
      })}
      <Button
        size="xs"
        variant="outline"
        color="fg.muted"
        fontWeight="500"
        onClick={(e) => {
          e.stopPropagation();
          onAddEvaluator?.();
        }}
        justifyContent="flex-start"
        data-testid={`add-evaluator-button-${target.id}`}
        // When evaluators exist, show on hover only (unless in expanded view)
        className={
          evaluators.length > 0 && !inExpandedView
            ? "cell-action-btn"
            : undefined
        }
        opacity={evaluators.length > 0 && !inExpandedView ? 0 : 1}
        transition="opacity 0.15s"
      >
        <LuPlus />
        {evaluators.length === 0 && <Text>Add evaluator</Text>}
      </Button>
    </HStack>
  );

  // Copy output to clipboard with feedback
  const handleCopyOutput = useCallback(() => {
    if (rawOutput) {
      navigator.clipboard.writeText(rawOutput);
      setHasCopied(true);
      setTimeout(() => setHasCopied(false), 2000);
    }
  }, [rawOutput]);

  // Render action buttons (latency, trace, copy, then run)
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
      bg={inExpandedView ? "transparent" : "bg.subtle"}
      borderRadius="md"
      paddingLeft={2}
      paddingRight={0.5}
    >
      {/* Latency display - shows when duration is available */}
      {duration !== null && duration !== undefined && (
        <Tooltip
          content={`Latency: ${formatLatency(duration)}`}
          positioning={{ placement: "top" }}
          openDelay={100}
        >
          <Text
            fontSize="11px"
            color="fg.muted"
            whiteSpace="nowrap"
            px={1}
            data-testid={`latency-${target.id}`}
          >
            {formatLatency(duration)}
          </Text>
        </Tooltip>
      )}
      {/* Trace link button - left of copy button */}
      {traceId && (
        <Tooltip
          content="View trace"
          positioning={{ placement: "top" }}
          openDelay={100}
        >
          <Button
            size="xs"
            variant="ghost"
            _hover={{ bg: "bg.emphasized" }}
            onClick={handleViewTrace}
            data-testid={`trace-link-${target.id}`}
          >
            <LuListTree />
          </Button>
        </Tooltip>
      )}
      {traceId && <TraceIdPeek traceId={traceId} />}
      {/* Copy button - shows when there's output */}
      {rawOutput && (
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
            data-testid={`copy-output-${target.id}`}
          >
            {hasCopied ? <LuCheck /> : <LuCopy />}
          </Button>
        </Tooltip>
      )}
      {/* Run/Stop cell button */}
      {onRunCell && (
        <Tooltip
          content={isLoading ? "Stop execution" : "Run this cell"}
          positioning={{ placement: "top" }}
          openDelay={100}
        >
          <Button
            size="xs"
            variant="ghost"
            _hover={{ bg: "bg.emphasized" }}
            onClick={(e) => {
              e.stopPropagation();
              if (isLoading && onStopCell) {
                onStopCell();
              } else {
                onRunCell();
                // Close expanded view when running
                if (inExpandedView) {
                  handleCloseExpanded();
                }
              }
            }}
            data-testid={`run-cell-${target.id}`}
          >
            {isLoading ? <LuSquare size={12} /> : <LuPlay size={12} />}
          </Button>
        </Tooltip>
      )}
    </HStack>
  );

  return (
    <>
      {/* Normal collapsed cell view */}
      <Box
        ref={cellRef}
        position="relative"
        height="100%"
        css={{ "&:hover .cell-action-btn": { opacity: 1 } }}
      >
        <VStack align="stretch" gap={2}>
          {renderActionButtons(false)}
          {renderOutput(false)}
          {renderPairwiseVerdicts()}
          {renderEvaluatorChips(false)}
        </VStack>
      </Box>

      {/* Expanded cell overlay - same content, just bigger with blue border */}
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
          {/* Expanded cell - overlaps original with negative offset, blue border */}
          <Box
            position="fixed"
            top={`${expandedPosition.top - 8}px`}
            left={`${expandedPosition.left - 8}px`}
            width={`${Math.max(expandedPosition.width + 16, 250)}px`}
            maxHeight="min(600px, calc(100vh - 32px))"
            bg="bg.panel/75"
            backdropFilter="blur(8px)"
            borderRadius="md"
            boxShadow="0 0 0 2px var(--chakra-colors-border-emphasized), 0 4px 12px rgba(0,0,0,0.15)"
            zIndex={1001}
            display="flex"
            flexDirection="column"
            p={3}
            overflow="hidden"
            css={{
              animation: "scale-in 0.15s ease-out",
            }}
          >
            <VStack
              align="stretch"
              gap={2}
              height="100%"
              position="relative"
              overflow="hidden"
            >
              {renderActionButtons(true)}
              <Box flex={1} minHeight={0} overflowY="auto">
                {renderOutput(true)}
              </Box>
              {renderEvaluatorChips(true)}
            </VStack>
          </Box>
        </Portal>
      )}
    </>
  );
}

// Resolves the pairwise winner/loser/tie tint for a chip rendered against
// `target`. Pulled out into its own component so the two `useTargetName`
// calls (one per variant) run at this component's top level — calling them
// inside `evaluators.map(...)` would violate React's rules-of-hooks.
//
// The stored label is the winner's candidate id, which for prompt-typed
// variants is the prompt HANDLE (e.g. "say-hi"), not the variant's target
// id. `normalizePairwiseLabel` collapses both label shapes (legacy
// "A"/"B"/"tie" + new winner-id, by id or handle) to a slot letter that
// can be compared against this chip's target.
function PairwiseAwareEvaluatorChip({
  target,
  targets,
  result,
  chipProps,
}: {
  target: TargetConfig;
  targets: TargetConfig[];
  result: unknown;
  chipProps: Omit<React.ComponentProps<typeof EvaluatorChip>, "pairwiseState">;
}) {
  const pw = chipProps.evaluator.pairwise;
  const variantATarget = pw
    ? (targets.find((t) => t.id === pw.variantA) ?? target)
    : target;
  const variantBTarget = pw
    ? (targets.find((t) => t.id === pw.variantB) ?? target)
    : target;
  const variantAName = useTargetName(variantATarget);
  const variantBName = useTargetName(variantBTarget);

  const pairwiseState = useMemo((): "winner" | "loser" | "tie" | undefined => {
    if (!pw) return undefined;
    const parsed = parseEvaluationResult(result);
    if (parsed.status !== "processed") return undefined;
    const slot = normalizePairwiseLabel(
      parsed.label,
      pw.variantA,
      pw.variantB,
      variantAName || undefined,
      variantBName || undefined,
    );
    if (!slot) return undefined;
    if (slot === "tie") return "tie";
    if (slot === "A") return target.id === pw.variantA ? "winner" : "loser";
    return target.id === pw.variantB ? "winner" : "loser";
  }, [pw, result, target.id, variantAName, variantBName]);

  return <EvaluatorChip {...chipProps} pairwiseState={pairwiseState} />;
}

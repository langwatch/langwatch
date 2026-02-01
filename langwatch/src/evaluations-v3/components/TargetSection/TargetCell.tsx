import {
  Box,
  Button,
  HStack,
  Portal,
  Skeleton,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import type { FieldMapping as UIFieldMapping } from "~/components/variables";
import { parseLLMError } from "~/utils/formatLLMError";
import { formatTargetOutput } from "~/utils/formatTargetOutput";
import { useDrawer } from "~/hooks/useDrawer";
import { useEvaluationsV3Store } from "../../hooks/useEvaluationsV3Store";
import type { EvaluatorConfig, TargetConfig } from "../../types";
import { formatLatency } from "../../utils/computeAggregates";
import {
  convertFromUIMapping,
  convertToUIMapping,
} from "../../utils/fieldMappingConverters";
import { evaluatorHasMissingMappings } from "../../utils/mappingValidation";
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
}: TargetCellContentProps) {
  const { openDrawer } = useDrawer();
  const {
    evaluators,
    activeDatasetId,
    datasets,
    removeEvaluator,
    setEvaluatorMapping,
    removeEvaluatorMapping,
  } = useEvaluationsV3Store((state) => ({
    evaluators: state.evaluators,
    activeDatasetId: state.activeDatasetId,
    datasets: state.datasets,
    removeEvaluator: state.removeEvaluator,
    setEvaluatorMapping: state.setEvaluatorMapping,
    removeEvaluatorMapping: state.removeEvaluatorMapping,
  }));

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

  // Helper to create mappingsConfig for an evaluator
  const createMappingsConfig = useCallback(
    (evaluator: EvaluatorConfig) => {
      const datasetIds = new Set(datasets.map((d) => d.id));
      const isDatasetSource = (sourceId: string) => datasetIds.has(sourceId);

      // Build available sources
      const activeDataset = datasets.find((d) => d.id === activeDatasetId);
      const availableSources = [];
      if (activeDataset) {
        availableSources.push({
          id: activeDataset.id,
          name: activeDataset.name,
          type: "dataset" as const,
          fields: activeDataset.columns.map((col) => ({
            name: col.name,
            type: "str" as const,
          })),
        });
      }
      // Use local config outputs if available (unsaved changes), fallback to saved outputs
      const effectiveOutputs = target.localPromptConfig?.outputs ?? target.outputs;
      availableSources.push({
        id: target.id,
        name: target.name,
        type: "signature" as const,
        fields: effectiveOutputs.map((o) => ({
          name: o.identifier,
          type: o.type as "str" | "float" | "bool",
        })),
      });

      // Get current mappings in UI format (used as initial state in the drawer)
      const storeMappings =
        evaluator.mappings[activeDatasetId]?.[target.id] ?? {};
      const initialMappings: Record<string, UIFieldMapping> = {};
      for (const [key, mapping] of Object.entries(storeMappings)) {
        initialMappings[key] = convertToUIMapping(mapping);
      }

      return {
        availableSources,
        initialMappings,
        onMappingChange: (
          identifier: string,
          mapping: UIFieldMapping | undefined,
        ) => {
          if (mapping) {
            const storeMapping = convertFromUIMapping(mapping, isDatasetSource);
            setEvaluatorMapping(
              evaluator.id,
              activeDatasetId,
              target.id,
              identifier,
              storeMapping,
            );
          } else {
            removeEvaluatorMapping(
              evaluator.id,
              activeDatasetId,
              target.id,
              identifier,
            );
          }
        },
      };
    },
    [
      datasets,
      activeDatasetId,
      target,
      setEvaluatorMapping,
      removeEvaluatorMapping,
    ],
  );

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
            cursor={isErrorOverflowing && !isErrorExpanded ? "pointer" : undefined}
            onClick={() => setIsErrorExpanded(true)}
            onDoubleClick={isErrorOverflowing ? () => setIsErrorExpanded(false) : undefined}
          >
            <Box flexShrink={0} paddingTop={0.5}>
              <LuCircleAlert size={16} />
            </Box>
            <Text lineClamp={expanded || isErrorExpanded ? undefined : 2} userSelect="text" whiteSpace="pre-wrap" wordBreak="break-word">
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

  // Render the evaluator chips section
  const renderEvaluatorChips = (inExpandedView: boolean) => (
    <HStack flexWrap="wrap" gap={1.5}>
      {evaluators.map((evaluator: EvaluatorConfig) => (
        <EvaluatorChip
          key={evaluator.id}
          evaluator={evaluator}
          result={evaluatorResults[evaluator.id]}
          hasMissingMappings={missingMappingsSet.has(evaluator.id)}
          isRunning={isEvaluatorRunning?.(evaluator.id) ?? false}
          onEdit={() => {
            const mappingsConfig = createMappingsConfig(evaluator);
            openDrawer("evaluatorEditor", {
              evaluatorId: evaluator.dbEvaluatorId,
              evaluatorType: evaluator.evaluatorType,
              mappingsConfig,
            });
          }}
          onRemove={() => removeEvaluator(evaluator.id)}
          onRerun={
            onRerunEvaluator ? () => onRerunEvaluator(evaluator.id) : undefined
          }
        />
      ))}
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

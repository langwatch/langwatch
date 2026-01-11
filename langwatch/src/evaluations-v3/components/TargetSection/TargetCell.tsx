import { useCallback, useMemo } from "react";
import { Box, Button, HStack, Text, VStack, Skeleton } from "@chakra-ui/react";
import { LuPlus, LuCircleAlert, LuSquareArrowOutUpRight } from "react-icons/lu";

import { useDrawer } from "~/hooks/useDrawer";
import { Tooltip } from "~/components/ui/tooltip";
import { useEvaluationsV3Store } from "../../hooks/useEvaluationsV3Store";
import { convertFromUIMapping, convertToUIMapping } from "../../utils/fieldMappingConverters";
import { evaluatorHasMissingMappings } from "../../utils/mappingValidation";
import type { TargetConfig, EvaluatorConfig } from "../../types";
import type { FieldMapping as UIFieldMapping } from "~/components/variables";
import { EvaluatorChip } from "../TargetSection/EvaluatorChip";

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
  onAddEvaluator?: () => void;
};

export function TargetCellContent({
  target,
  output,
  evaluatorResults,
  error,
  isLoading,
  traceId,
  onAddEvaluator,
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

  // Handler to open trace drawer
  const handleViewTrace = useCallback(() => {
    if (!traceId) return;
    openDrawer("traceDetails", { traceId });
  }, [traceId, openDrawer]);

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
      availableSources.push({
        id: target.id,
        name: target.name,
        type: "signature" as const,
        fields: target.outputs.map((o) => ({
          name: o.identifier,
          type: o.type as "str" | "float" | "bool",
        })),
      });

      // Get current mappings in UI format (used as initial state in the drawer)
      const storeMappings = evaluator.mappings[activeDatasetId]?.[target.id] ?? {};
      const initialMappings: Record<string, UIFieldMapping> = {};
      for (const [key, mapping] of Object.entries(storeMappings)) {
        initialMappings[key] = convertToUIMapping(mapping);
      }

      return {
        availableSources,
        initialMappings,
        onMappingChange: (identifier: string, mapping: UIFieldMapping | undefined) => {
          if (mapping) {
            const storeMapping = convertFromUIMapping(mapping, isDatasetSource);
            setEvaluatorMapping(evaluator.id, activeDatasetId, target.id, identifier, storeMapping);
          } else {
            removeEvaluatorMapping(evaluator.id, activeDatasetId, target.id, identifier);
          }
        },
      };
    },
    [datasets, activeDatasetId, target, setEvaluatorMapping, removeEvaluatorMapping]
  );

  const displayOutput =
    output === null || output === undefined
      ? ""
      : typeof output === "object"
      ? JSON.stringify(output)
      : String(output);

  // Determine what to show based on state
  const renderOutput = () => {
    // Loading state - show skeleton
    if (isLoading && !output && !error) {
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
          <Text lineClamp={2}>{error}</Text>
        </HStack>
      );
    }

    // Normal output
    if (displayOutput) {
      return (
        <Text fontSize="13px" lineClamp={3}>
          {displayOutput}
        </Text>
      );
    }

    // No output yet
    return (
      <Text fontSize="13px" color="gray.400">
        No output yet
      </Text>
    );
  };

  return (
    <Box position="relative" css={{ "&:hover .trace-link": { opacity: 1 } }}>
      <VStack align="stretch" gap={2}>
        {/* Trace link button - shows on hover when trace is available */}
        {traceId && (
          <Tooltip content="View trace" positioning={{ placement: "top" }} openDelay={100}>
            <Button
              size="xs"
              variant="outline"
              onClick={handleViewTrace}
              data-testid={`trace-link-${target.id}`}
              className="trace-link"
              position="absolute"
              top={-1}
              right={-1}
              opacity={0}
              transition="opacity 0.15s"
              zIndex={1}
              bg="white"
              boxShadow="sm"
            >
              <LuSquareArrowOutUpRight />
            </Button>
          </Tooltip>
        )}

      {/* Target output or loading/error state */}
      {renderOutput()}

      <HStack flexWrap="wrap" gap={1.5}>
        {evaluators.map((evaluator: EvaluatorConfig) => (
          <EvaluatorChip
            key={evaluator.id}
            evaluator={evaluator}
            result={evaluatorResults[evaluator.id]}
            hasMissingMappings={missingMappingsSet.has(evaluator.id)}
            targetHasOutput={output !== undefined && output !== null}
            onEdit={() => {
              // Create mappingsConfig and pass it to the drawer
              const mappingsConfig = createMappingsConfig(evaluator);

              // Open the evaluator editor drawer with the DB evaluator ID
              // mappingsConfig is an object so it goes to complexProps automatically
              openDrawer("evaluatorEditor", {
                evaluatorId: evaluator.dbEvaluatorId,
                evaluatorType: evaluator.evaluatorType,
                mappingsConfig,
              });
            }}
            onRemove={() => removeEvaluator(evaluator.id)}
          />
        ))}
        {/* Add evaluator button */}
        <Button
          size="xs"
          variant="outline"
          color="gray.500"
          fontWeight="500"
          onClick={(e) => {
            e.stopPropagation();
            onAddEvaluator?.();
          }}
          justifyContent="flex-start"
          data-testid={`add-evaluator-button-${target.id}`}
        >
          <LuPlus />
          {evaluators.length === 0 && <Text>Add evaluator</Text>}
        </Button>
      </HStack>
      </VStack>
    </Box>
  );
}

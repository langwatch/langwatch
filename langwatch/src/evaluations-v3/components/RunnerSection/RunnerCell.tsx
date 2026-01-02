import { useCallback, useMemo } from "react";
import { Button, HStack, Text, VStack } from "@chakra-ui/react";
import { LuPlus } from "react-icons/lu";

import { useDrawer } from "~/hooks/useDrawer";
import { useEvaluationsV3Store } from "../../hooks/useEvaluationsV3Store";
import { useEvaluatorMappings } from "../../hooks/useEvaluatorMappings";
import { convertFromUIMapping, convertToUIMapping } from "../../utils/fieldMappingConverters";
import { evaluatorHasMissingMappings } from "../../utils/mappingValidation";
import type { RunnerConfig, EvaluatorConfig } from "../../types";
import type { FieldMapping as UIFieldMapping } from "~/components/variables";
import { EvaluatorChip } from "./EvaluatorChip";

type RunnerCellContentProps = {
  runner: RunnerConfig;
  output: unknown;
  evaluatorResults: Record<string, unknown>;
  row: number;
  onAddEvaluator?: () => void;
};

export function RunnerCellContent({
  runner,
  output,
  evaluatorResults,
  onAddEvaluator,
}: RunnerCellContentProps) {
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

  // Calculate which evaluators have missing mappings for this runner
  const missingMappingsSet = useMemo(() => {
    const missing = new Set<string>();
    for (const evaluator of evaluators) {
      if (evaluatorHasMissingMappings(evaluator, activeDatasetId, runner.id)) {
        missing.add(evaluator.id);
      }
    }
    return missing;
  }, [evaluators, activeDatasetId, runner.id]);

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
        id: runner.id,
        name: runner.name,
        type: "signature" as const,
        fields: runner.outputs.map((o) => ({
          name: o.identifier,
          type: o.type as "str" | "float" | "bool",
        })),
      });

      // Get current mappings in UI format (used as initial state in the drawer)
      const storeMappings = evaluator.mappings[activeDatasetId]?.[runner.id] ?? {};
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
            setEvaluatorMapping(evaluator.id, activeDatasetId, runner.id, identifier, storeMapping);
          } else {
            removeEvaluatorMapping(evaluator.id, activeDatasetId, runner.id, identifier);
          }
        },
      };
    },
    [datasets, activeDatasetId, runner, setEvaluatorMapping, removeEvaluatorMapping]
  );

  const displayOutput =
    output === null || output === undefined
      ? ""
      : typeof output === "object"
      ? JSON.stringify(output)
      : String(output);

  return (
    <VStack align="stretch" gap={2}>
      {/* Runner output */}
      <Text fontSize="13px" lineClamp={3}>
        {displayOutput || (
          <Text as="span" color="gray.400">
            No output yet
          </Text>
        )}
      </Text>

      <HStack flexWrap="wrap" gap={1.5}>
        {evaluators.map((evaluator: EvaluatorConfig) => (
          <EvaluatorChip
            key={evaluator.id}
            evaluator={evaluator}
            result={evaluatorResults[evaluator.id]}
            hasMissingMappings={missingMappingsSet.has(evaluator.id)}
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
          data-testid={`add-evaluator-button-${runner.id}`}
        >
          <LuPlus />
          {evaluators.length === 0 && <Text>Add evaluator</Text>}
        </Button>
      </HStack>
    </VStack>
  );
}

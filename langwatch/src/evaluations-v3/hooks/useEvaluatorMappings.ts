/**
 * Hook for deriving mappings and sources for evaluators in evaluations context.
 *
 * When the evaluator editor drawer is opened from evaluations V3, this hook provides:
 * - availableSources derived from the active dataset AND the specific runner's outputs
 * - inputMappings derived from the evaluator's mappings for the active dataset and runner
 *
 * This enables the drawer to reactively update when the active dataset changes.
 */

import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import { useEvaluationsV3Store } from "./useEvaluationsV3Store";
import { convertToUIMapping } from "../utils/fieldMappingConverters";
import {
  datasetColumnTypeToFieldType,
  type AvailableSource,
  type FieldMapping as UIFieldMapping,
} from "~/components/variables";

type UseEvaluatorMappingsResult = {
  /** Available sources for variable mapping (active dataset columns + runner outputs) */
  availableSources: AvailableSource[];
  /** Input mappings in UI format for the evaluator on the active dataset/runner */
  inputMappings: Record<string, UIFieldMapping>;
  /** Current active dataset ID */
  activeDatasetId: string;
  /** Whether the hook has valid data */
  isValid: boolean;
};

/**
 * Hook to get reactive mappings and sources for an evaluator in evaluations context.
 *
 * @param evaluatorId - The evaluator ID (from the V3 store) to get mappings for.
 * @param runnerId - The runner ID to get mappings for.
 * @returns Reactive mappings and sources that update when the active dataset changes.
 */
export const useEvaluatorMappings = (
  evaluatorId: string | undefined,
  runnerId: string | undefined
): UseEvaluatorMappingsResult => {
  const { activeDatasetId, datasets, evaluator, runner } = useEvaluationsV3Store(
    useShallow((state) => ({
      activeDatasetId: state.activeDatasetId,
      datasets: state.datasets,
      evaluator: evaluatorId
        ? state.evaluators.find((e) => e.id === evaluatorId || e.dbEvaluatorId === evaluatorId)
        : undefined,
      runner: runnerId ? state.runners.find((r) => r.id === runnerId) : undefined,
    }))
  );

  // Build available sources from the active dataset AND the runner's outputs
  const availableSources = useMemo((): AvailableSource[] => {
    const sources: AvailableSource[] = [];

    // Add dataset columns
    const activeDataset = datasets.find((d) => d.id === activeDatasetId);
    if (activeDataset) {
      sources.push({
        id: activeDataset.id,
        name: activeDataset.name,
        type: "dataset" as const,
        fields: activeDataset.columns.map((col) => ({
          name: col.name,
          type: datasetColumnTypeToFieldType(col.type),
        })),
      });
    }

    // Add runner outputs (use "signature" type as it represents a prompt/runner node)
    if (runner) {
      sources.push({
        id: runner.id,
        name: runner.name,
        type: "signature" as const,
        fields: runner.outputs.map((output) => ({
          name: output.identifier,
          type: output.type as "str" | "float" | "bool" | "image" | "list" | "dict",
        })),
      });
    }

    return sources;
  }, [datasets, activeDatasetId, runner]);

  // Convert evaluator mappings for the active dataset and runner to UI format
  const inputMappings = useMemo((): Record<string, UIFieldMapping> => {
    if (!evaluator || !runnerId) return {};

    const datasetMappings = evaluator.mappings[activeDatasetId];
    const runnerMappings = datasetMappings?.[runnerId] ?? {};
    const uiMappings: Record<string, UIFieldMapping> = {};
    for (const [key, mapping] of Object.entries(runnerMappings)) {
      uiMappings[key] = convertToUIMapping(mapping);
    }
    return uiMappings;
  }, [evaluator, runnerId, activeDatasetId]);

  return {
    availableSources,
    inputMappings,
    activeDatasetId,
    isValid: !!evaluatorId && !!evaluator && !!runnerId && !!runner,
  };
};

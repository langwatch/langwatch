/**
 * Hook for deriving mappings and sources in evaluations context.
 *
 * When the drawer is opened from evaluations V3, this hook provides:
 * - availableSources derived from the active dataset
 * - inputMappings derived from the runner's mappings for the active dataset
 *
 * This enables the drawer to reactively update when the active dataset changes.
 */

import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import { useEvaluationsV3Store } from "./useEvaluationsV3Store";
import { convertToUIMapping } from "../utils/fieldMappingConverters";
import { datasetColumnTypeToFieldType, type AvailableSource, type FieldMapping as UIFieldMapping } from "~/components/variables";

type UseEvaluationMappingsResult = {
  /** Available sources for variable mapping (active dataset columns) */
  availableSources: AvailableSource[];
  /** Input mappings in UI format for the runner on the active dataset */
  inputMappings: Record<string, UIFieldMapping>;
  /** Current active dataset ID */
  activeDatasetId: string;
  /** Whether the hook has valid data */
  isValid: boolean;
};

/**
 * Hook to get reactive mappings and sources for a runner in evaluations context.
 *
 * @param runnerId - The runner ID to get mappings for. If undefined, returns empty data.
 * @returns Reactive mappings and sources that update when the active dataset changes.
 */
export const useEvaluationMappings = (runnerId: string | undefined): UseEvaluationMappingsResult => {
  const { activeDatasetId, datasets, runner } = useEvaluationsV3Store(
    useShallow((state) => ({
      activeDatasetId: state.activeDatasetId,
      datasets: state.datasets,
      runner: runnerId ? state.runners.find((r) => r.id === runnerId) : undefined,
    }))
  );

  // Build available sources from the active dataset only
  const availableSources = useMemo((): AvailableSource[] => {
    const activeDataset = datasets.find((d) => d.id === activeDatasetId);
    if (!activeDataset) return [];

    return [{
      id: activeDataset.id,
      name: activeDataset.name,
      type: "dataset" as const,
      fields: activeDataset.columns.map((col) => ({
        name: col.name,
        type: datasetColumnTypeToFieldType(col.type),
      })),
    }];
  }, [datasets, activeDatasetId]);

  // Convert runner mappings for the active dataset to UI format
  const inputMappings = useMemo((): Record<string, UIFieldMapping> => {
    if (!runner) return {};

    const datasetMappings = runner.mappings[activeDatasetId] ?? {};
    const uiMappings: Record<string, UIFieldMapping> = {};
    for (const [key, mapping] of Object.entries(datasetMappings)) {
      uiMappings[key] = convertToUIMapping(mapping);
    }
    return uiMappings;
  }, [runner, activeDatasetId]);

  return {
    availableSources,
    inputMappings,
    activeDatasetId,
    isValid: !!runnerId && !!runner,
  };
};

/**
 * Hook for deriving mappings and sources in evaluations context.
 *
 * When the drawer is opened from evaluations V3, this hook provides:
 * - availableSources derived from the active dataset
 * - inputMappings derived from the target's mappings for the active dataset
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
  /** Input mappings in UI format for the target on the active dataset */
  inputMappings: Record<string, UIFieldMapping>;
  /** Current active dataset ID */
  activeDatasetId: string;
  /** Whether the hook has valid data */
  isValid: boolean;
};

/**
 * Hook to get reactive mappings and sources for a target in evaluations context.
 *
 * @param targetId - The target ID to get mappings for. If undefined, returns empty data.
 * @returns Reactive mappings and sources that update when the active dataset changes.
 */
export const useEvaluationMappings = (targetId: string | undefined): UseEvaluationMappingsResult => {
  const { activeDatasetId, datasets, target } = useEvaluationsV3Store(
    useShallow((state) => ({
      activeDatasetId: state.activeDatasetId,
      datasets: state.datasets,
      target: targetId ? state.targets.find((r) => r.id === targetId) : undefined,
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

  // Convert target mappings for the active dataset to UI format
  const inputMappings = useMemo((): Record<string, UIFieldMapping> => {
    if (!target) return {};

    const datasetMappings = target.mappings[activeDatasetId] ?? {};
    const uiMappings: Record<string, UIFieldMapping> = {};
    for (const [key, mapping] of Object.entries(datasetMappings)) {
      uiMappings[key] = convertToUIMapping(mapping);
    }
    return uiMappings;
  }, [target, activeDatasetId]);

  return {
    availableSources,
    inputMappings,
    activeDatasetId,
    isValid: !!targetId && !!target,
  };
};

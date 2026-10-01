/**
 * Hook for deriving mappings and sources in evaluations context.
 */

import { setComplexProps, useDrawer, useDrawerParams } from "@langwatch/browser-host/use-drawer";
import {
  type AvailableSource,
  type FieldMapping as UIFieldMapping,
} from "@langwatch/workflow-contract";
import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import { convertToUIMapping } from "../../model/experiments-v3/field-mapping-converters.ts";
import { datasetColumnTypeToFieldType } from "../../model/workflow/studio-dataset.utils.ts";
import { useEvaluationsV3Store } from "./use-evaluations-v3-store.ts";

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
 * @param targetId - The target ID to get mappings for. If undefined, returns empty data.
 * @returns Reactive mappings and sources that update when the active dataset changes.
 */
export const useEvaluationMappings = (
  targetId: string | undefined,
): UseEvaluationMappingsResult => {
  const { activeDatasetId, datasets, target } = useEvaluationsV3Store(
    useShallow((state) => ({
      activeDatasetId: state.activeDatasetId,
      datasets: state.datasets,
      target: targetId ? state.targets.find((r) => r.id === targetId) : undefined,
    })),
  );

  // Build available sources from the active dataset only
  const availableSources = useMemo((): AvailableSource[] => {
    const activeDataset = datasets.find((d) => d.id === activeDatasetId);
    if (!activeDataset) return [];

    return [
      {
        id: activeDataset.id,
        name: activeDataset.name,
        type: "dataset" as const,
        fields: activeDataset.columns.map((col) => ({
          name: col.name,
          type: datasetColumnTypeToFieldType(col.type),
        })),
      },
    ];
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

/**
 * Hands the open prompt editor this experiment's mappings and sources for its
 * target as drawer props, again whenever the active dataset or mappings change.
 */
export function useSyncPromptEditorMappings(): void {
  const { currentDrawer } = useDrawer();
  const targetId = useDrawerParams().targetId;
  const editedTargetId =
    currentDrawer === "promptEditor" && typeof targetId === "string" ? targetId : undefined;
  const { availableSources, inputMappings, isValid } = useEvaluationMappings(editedTargetId);

  useEffect(() => {
    if (!isValid) return;
    setComplexProps({ availableSources, inputMappings });
  }, [isValid, availableSources, inputMappings]);
}

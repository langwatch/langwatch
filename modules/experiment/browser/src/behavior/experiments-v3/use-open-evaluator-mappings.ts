/**
 * Hook to open the evaluator editor on an evaluator's missing mappings for one target,
 * with variable-mapping sources ordered dataset-first. The run button uses it.
 */

import { setFlowCallbacks, useDrawer } from "@langwatch/browser-host/drawer";
import type { AvailableSource, FieldMapping as UIFieldMapping } from "@langwatch/workflow-contract";
import { useCallback } from "react";
import { useShallow } from "zustand/react/shallow";

import { createEvaluatorEditorCallbacks } from "../../model/experiments-v3/evaluator-editor-callbacks.ts";
import {
  convertFromUIMapping,
  convertToUIMapping,
} from "../../model/experiments-v3/field-mapping-converters.ts";
import type { EvaluatorConfig, TargetConfig } from "../../model/experiments-v3/types.ts";
import { isComparisonEvaluator } from "../../model/experiments-v3/types.ts";
import { useEvaluationsV3Store } from "./use-evaluations-v3-store.ts";
import { useOpenComparisonEditor } from "./use-open-evaluator-editor.ts";
import { useResolveTargetName } from "./use-resolve-target-name.ts";

type WorkbenchDataset = { id: string; name: string; columns: { name: string }[] };

const mappingSourcesOf = ({
  activeDataset,
  target,
  targetName,
}: {
  activeDataset: WorkbenchDataset | undefined;
  target: TargetConfig | undefined;
  targetName: string;
}): AvailableSource[] => [
  ...(activeDataset
    ? [
        {
          id: activeDataset.id,
          name: activeDataset.name,
          type: "dataset" as const,
          fields: activeDataset.columns.map((col) => ({ name: col.name, type: "str" as const })),
        },
      ]
    : []),
  ...(target
    ? [
        {
          id: target.id,
          name: targetName,
          type: "signature" as const,
          fields: target.outputs.map((o) => ({
            name: o.identifier,
            type: o.type,
          })),
        },
      ]
    : []),
];

/**
 * A chip-style comparison evaluator is tied to no one target, so it opens the variants
 * picker instead. onMappingChange is registered through setFlowCallbacks (durable), never
 * inside mappingsConfig, which rides the drawer's ephemeral complex props.
 */
export const useOpenEvaluatorMappings = () => {
  const { openDrawer } = useDrawer();
  const openComparisonEditor = useOpenComparisonEditor();
  const resolveTargetName = useResolveTargetName();
  const { targets, datasets, activeDatasetId, setEvaluatorMapping, removeEvaluatorMapping } =
    useEvaluationsV3Store(
      useShallow((state) => ({
        targets: state.targets,
        datasets: state.datasets,
        activeDatasetId: state.activeDatasetId,
        setEvaluatorMapping: state.setEvaluatorMapping,
        removeEvaluatorMapping: state.removeEvaluatorMapping,
      })),
    );

  return useCallback(
    ({ evaluator, targetId }: { evaluator: EvaluatorConfig; targetId: string }) => {
      if (isComparisonEvaluator(evaluator)) {
        openComparisonEditor(evaluator);
        return;
      }
      const target = targets.find((r) => r.id === targetId);
      const availableSources = mappingSourcesOf({
        activeDataset: datasets.find((d) => d.id === activeDatasetId),
        target,
        targetName: target ? resolveTargetName(target) : "",
      });
      const storeMappings = evaluator.mappings[activeDatasetId]?.[targetId] ?? {};
      const initialMappings: Record<string, UIFieldMapping> = Object.fromEntries(
        Object.entries(storeMappings).map(([key, mapping]) => [key, convertToUIMapping(mapping)]),
      );

      const datasetIds = new Set(datasets.map((d) => d.id));
      const isDatasetSource = (sourceId: string) => datasetIds.has(sourceId);
      const field = { evaluatorId: evaluator.id, datasetId: activeDatasetId, targetId };
      const onMappingChange = (identifier: string, mapping: UIFieldMapping | undefined) => {
        if (!mapping) return removeEvaluatorMapping({ ...field, inputField: identifier });
        setEvaluatorMapping({
          ...field,
          inputField: identifier,
          mapping: convertFromUIMapping(mapping, isDatasetSource),
        });
      };

      setFlowCallbacks("evaluatorEditor", createEvaluatorEditorCallbacks({ onMappingChange }));
      openDrawer("evaluatorEditor", {
        evaluatorId: evaluator.dbEvaluatorId,
        evaluatorType: evaluator.evaluatorType,
        mappingsConfig: { availableSources, initialMappings },
      });
    },
    [
      openDrawer,
      openComparisonEditor,
      resolveTargetName,
      targets,
      datasets,
      activeDatasetId,
      setEvaluatorMapping,
      removeEvaluatorMapping,
    ],
  );
};

/**
 * Hook to open the *grading evaluator* editor drawer for a given
 * (evaluator, target) pair, with variable-mapping sources ordered target-first.
 *
 * Distinct from useOpenTargetEditor, which edits a TARGET (and exposes only the
 * dataset as a mapping source). Here the entity is an EvaluatorConfig that
 * applies to all targets; the graded field (e.g. "output") should surface the
 * runner's outputs ahead of dataset columns, so target outputs come first.
 *
 * Shared by:
 *  - TargetCell: clicking an evaluator chip to edit its mapping for that cell.
 *  - EvaluationsV3Table: auto-opening when a freshly added evaluator still has
 *    unmapped required fields, so the user is shown where to map them instead
 *    of the picker silently closing.
 */

import { useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import type {
  AvailableSource,
  FieldMapping as UIFieldMapping,
} from "~/components/variables";
import { setFlowCallbacks, useDrawer } from "~/hooks/useDrawer";
import type { EvaluatorConfig, TargetConfig } from "../types";
import { createEvaluatorEditorCallbacks } from "../utils/evaluatorEditorCallbacks";
import {
  convertFromUIMapping,
  convertToUIMapping,
} from "../utils/fieldMappingConverters";
import { useEvaluationsV3Store } from "./useEvaluationsV3Store";

export const useOpenEvaluatorEditor = () => {
  const { openDrawer } = useDrawer();

  const {
    datasets,
    activeDatasetId,
    targets,
    updateEvaluator,
    setEvaluatorMapping,
    removeEvaluatorMapping,
  } = useEvaluationsV3Store(
    useShallow((state) => ({
      datasets: state.datasets,
      activeDatasetId: state.activeDatasetId,
      targets: state.targets,
      updateEvaluator: state.updateEvaluator,
      setEvaluatorMapping: state.setEvaluatorMapping,
      removeEvaluatorMapping: state.removeEvaluatorMapping,
    })),
  );

  return useCallback(
    ({
      evaluator,
      target,
      targetName,
      isCodeEvaluator,
    }: {
      evaluator: EvaluatorConfig;
      target: TargetConfig;
      targetName: string;
      isCodeEvaluator: boolean;
    }) => {
      // Build available sources. Target outputs come FIRST: for an evaluator,
      // the graded field (e.g. "output") should offer the runner's outputs
      // ahead of dataset columns, mirroring how inputs prefer the dataset.
      const activeDataset = datasets.find((d) => d.id === activeDatasetId);
      // Use local config outputs if available (unsaved changes), fallback to saved.
      const effectiveOutputs =
        target.localPromptConfig?.outputs ?? target.outputs;
      const availableSources: AvailableSource[] = [
        {
          id: target.id,
          name: targetName,
          type: "signature" as const,
          fields: effectiveOutputs.map((o) => ({
            name: o.identifier,
            type: o.type as "str" | "float" | "bool",
          })),
        },
      ];
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

      // Current mappings in UI format (initial state for the drawer).
      const storeMappings =
        evaluator.mappings[activeDatasetId]?.[target.id] ?? {};
      const initialMappings: Record<string, UIFieldMapping> = {};
      for (const [key, mapping] of Object.entries(storeMappings)) {
        initialMappings[key] = convertToUIMapping(mapping);
      }
      const mappingsConfig = { availableSources, initialMappings };

      const datasetIds = new Set(datasets.map((d) => d.id));
      const isDatasetSource = (sourceId: string) => datasetIds.has(sourceId);
      const onMappingChange = (
        identifier: string,
        mapping: UIFieldMapping | undefined,
      ) => {
        if (mapping) {
          setEvaluatorMapping(
            evaluator.id,
            activeDatasetId,
            target.id,
            identifier,
            convertFromUIMapping(mapping, isDatasetSource),
          );
        } else {
          removeEvaluatorMapping(
            evaluator.id,
            activeDatasetId,
            target.id,
            identifier,
          );
        }
      };

      // Code evaluators have their own editor (the Python code block plus its
      // inputs and outputs); the generic editor can only show the mapping.
      // Route them to the code editor, with the inputs and their mapping merged.
      if (isCodeEvaluator) {
        setFlowCallbacks(
          "codeEvaluatorEditor",
          createEvaluatorEditorCallbacks({ onMappingChange }),
        );
        openDrawer("codeEvaluatorEditor", {
          evaluatorId: evaluator.dbEvaluatorId,
          mappingsConfig,
        });
        return;
      }

      // Pairwise compare evaluators (#5100): bypass the per-row mapping form
      // and render a target+golden picker instead. The four required input
      // fields (candidate_a_*/candidate_b_*) have no per-row source — they
      // come from two OTHER targets' outputs, picked once via the form.
      // The orchestrator's Phase-2 cell generator reads evaluator.pairwise
      // to assemble those inputs at run time.
      if (evaluator.evaluatorType === "langevals/pairwise_compare") {
        const activeDataset = datasets.find((d) => d.id === activeDatasetId);
        setFlowCallbacks(
          "evaluatorEditor",
          createEvaluatorEditorCallbacks({
            onLocalConfigChange: (localEvaluatorConfig) => {
              updateEvaluator(evaluator.id, { localEvaluatorConfig });
            },
            onPairwiseChange: (pairwise) => {
              updateEvaluator(evaluator.id, { pairwise });
            },
          }),
        );
        openDrawer("evaluatorEditor", {
          evaluatorId: evaluator.dbEvaluatorId,
          evaluatorType: evaluator.evaluatorType,
          initialLocalConfig: evaluator.localEvaluatorConfig,
          // Non-serializable extras consumed by the drawer body.
          pairwiseContext: {
            initialPairwise: evaluator.pairwise,
            // Pass full TargetConfig so the picker's `useTargetName` hook
            // can resolve human-readable handles (it needs `type`,
            // `promptId`, `dbAgentId`, `targetEvaluatorId` — stripping to
            // `{id}` would force the dropdown to show raw `target_NNNN` ids).
            targets,
            datasetColumns:
              activeDataset?.columns.map((c) => ({
                id: c.id,
                name: c.name,
              })) ?? [],
          },
        });
        return;
      }

      // Route all non-serializable callbacks through setFlowCallbacks.
      // onMappingChange + onLocalConfigChange must live here (not in
      // mappingsConfig) so the drawer's mappings section renders — see
      // issue #3441. The local config persists onto the evaluator, not the
      // target, so use the direct onLocalConfigChange form.
      setFlowCallbacks(
        "evaluatorEditor",
        createEvaluatorEditorCallbacks({
          onLocalConfigChange: (localEvaluatorConfig) => {
            updateEvaluator(evaluator.id, { localEvaluatorConfig });
          },
          onMappingChange,
        }),
      );
      openDrawer("evaluatorEditor", {
        evaluatorId: evaluator.dbEvaluatorId,
        evaluatorType: evaluator.evaluatorType,
        mappingsConfig,
        initialLocalConfig: evaluator.localEvaluatorConfig,
      });
    },
    [
      openDrawer,
      datasets,
      activeDatasetId,
      targets,
      updateEvaluator,
      setEvaluatorMapping,
      removeEvaluatorMapping,
    ],
  );
};

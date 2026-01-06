/**
 * Global "Run Evaluation" button with validation.
 *
 * Before executing an evaluation:
 * 1. Validates all targets have their required mappings
 * 2. Validates all evaluators have their required mappings
 * 3. If any mapping is missing, opens the first drawer with missing mappings
 */

import { Button } from "@chakra-ui/react";
import { LuPlay } from "react-icons/lu";
import { useShallow } from "zustand/react/shallow";
import { Tooltip } from "~/components/ui/tooltip";
import type { FieldMapping as UIFieldMapping } from "~/components/variables";
import { useDrawer } from "~/hooks/useDrawer";
import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";
import { useOpenTargetEditor } from "../hooks/useOpenTargetEditor";
import {
  convertFromUIMapping,
  convertToUIMapping,
} from "../utils/fieldMappingConverters";
import { validateWorkbench } from "../utils/mappingValidation";

type RunEvaluationButtonProps = {
  /** Whether the button is disabled (e.g., while loading) */
  disabled?: boolean;
};

export const RunEvaluationButton = ({
  disabled = false,
}: RunEvaluationButtonProps) => {
  const { openDrawer } = useDrawer();
  const { openTargetEditor } = useOpenTargetEditor();

  const {
    targets,
    evaluators,
    activeDatasetId,
    datasets,
    setEvaluatorMapping,
    removeEvaluatorMapping,
  } = useEvaluationsV3Store(
    useShallow((state) => ({
      targets: state.targets,
      evaluators: state.evaluators,
      activeDatasetId: state.activeDatasetId,
      datasets: state.datasets,
      setEvaluatorMapping: state.setEvaluatorMapping,
      removeEvaluatorMapping: state.removeEvaluatorMapping,
    })),
  );

  const hasTargets = targets.length > 0;

  const handleClick = () => {
    if (!hasTargets) {
      // Open the target type selector to add a target
      openDrawer("targetTypeSelector", {});
      return;
    }

    // Validate all targets and evaluators
    const validation = validateWorkbench(targets, evaluators, activeDatasetId);

    if (!validation.isValid) {
      // Open the drawer for the first entity with missing mappings
      if (validation.firstInvalidTarget) {
        const target = validation.firstInvalidTarget.target;
        // Open target editor with proper flow callbacks
        void openTargetEditor(target);
      } else if (validation.firstInvalidEvaluator) {
        const { evaluator, targetId } = validation.firstInvalidEvaluator;
        const target = targets.find((r) => r.id === targetId);

        // Build mappingsConfig for the evaluator drawer
        const datasetIds = new Set(datasets.map((d) => d.id));
        const isDatasetSource = (sourceId: string) => datasetIds.has(sourceId);
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
        if (target) {
          availableSources.push({
            id: target.id,
            name: target.name,
            type: "signature" as const,
            fields: target.outputs.map((o) => ({
              name: o.identifier,
              type: o.type as "str" | "float" | "bool",
            })),
          });
        }

        const storeMappings =
          evaluator.mappings[activeDatasetId]?.[targetId] ?? {};
        const initialMappings: Record<string, UIFieldMapping> = {};
        for (const [key, mapping] of Object.entries(storeMappings)) {
          initialMappings[key] = convertToUIMapping(mapping);
        }

        const mappingsConfig = {
          availableSources,
          initialMappings,
          onMappingChange: (
            identifier: string,
            mapping: UIFieldMapping | undefined,
          ) => {
            if (mapping) {
              const storeMapping = convertFromUIMapping(
                mapping,
                isDatasetSource,
              );
              setEvaluatorMapping(
                evaluator.id,
                activeDatasetId,
                targetId,
                identifier,
                storeMapping,
              );
            } else {
              removeEvaluatorMapping(
                evaluator.id,
                activeDatasetId,
                targetId,
                identifier,
              );
            }
          },
        };

        // Open the evaluator editor drawer
        // mappingsConfig is an object so it goes to complexProps automatically
        openDrawer("evaluatorEditor", {
          evaluatorId: evaluator.dbEvaluatorId,
          evaluatorType: evaluator.evaluatorType,
          mappingsConfig,
        });
      }
      return;
    }

    // All validations passed - run the evaluation
    // TODO: Actually trigger the evaluation
    console.log("All validations passed - ready to run evaluation!");
  };

  // Determine button state and tooltip
  const getTooltipContent = () => {
    if (!hasTargets) {
      return "Click to add a target";
    }
    const validation = validateWorkbench(targets, evaluators, activeDatasetId);
    if (!validation.isValid) {
      if (validation.firstInvalidTarget) {
        return `Configure missing mappings for "${validation.firstInvalidTarget.target.name}"`;
      }
      if (validation.firstInvalidEvaluator) {
        return `Configure missing mappings for evaluator`;
      }
    }
    return "Run evaluation on all targets";
  };

  return (
    <Tooltip
      content={getTooltipContent()}
      positioning={{ placement: "bottom" }}
      openDelay={200}
    >
      <Button
        size="sm"
        variant="outline"
        onClick={handleClick}
        disabled={disabled}
        data-testid="run-evaluation-button"
      >
        <LuPlay size={14} />
        Run
      </Button>
    </Tooltip>
  );
};

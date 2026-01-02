/**
 * Global "Run Evaluation" button with validation.
 *
 * Before executing an evaluation:
 * 1. Validates all runners have their required mappings
 * 2. Validates all evaluators have their required mappings
 * 3. If any mapping is missing, opens the first drawer with missing mappings
 */

import { Button } from "@chakra-ui/react";
import { LuPlay } from "react-icons/lu";
import { useShallow } from "zustand/react/shallow";

import { useDrawer } from "~/hooks/useDrawer";
import { Tooltip } from "~/components/ui/tooltip";
import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";
import { useOpenRunnerEditor } from "../hooks/useOpenRunnerEditor";
import { validateWorkbench } from "../utils/mappingValidation";
import { convertToUIMapping, convertFromUIMapping } from "../utils/fieldMappingConverters";
import type { FieldMapping as UIFieldMapping } from "~/components/variables";

type RunEvaluationButtonProps = {
  /** Whether the button is disabled (e.g., while loading) */
  disabled?: boolean;
};

export const RunEvaluationButton = ({
  disabled = false,
}: RunEvaluationButtonProps) => {
  const { openDrawer } = useDrawer();
  const { openRunnerEditor } = useOpenRunnerEditor();

  const {
    runners,
    evaluators,
    activeDatasetId,
    datasets,
    setEvaluatorMapping,
    removeEvaluatorMapping,
  } = useEvaluationsV3Store(
    useShallow((state) => ({
      runners: state.runners,
      evaluators: state.evaluators,
      activeDatasetId: state.activeDatasetId,
      datasets: state.datasets,
      setEvaluatorMapping: state.setEvaluatorMapping,
      removeEvaluatorMapping: state.removeEvaluatorMapping,
    }))
  );

  const hasRunners = runners.length > 0;

  const handleClick = () => {
    if (!hasRunners) {
      // Open the runner type selector to add a runner
      openDrawer("runnerTypeSelector", {});
      return;
    }

    // Validate all runners and evaluators
    const validation = validateWorkbench(runners, evaluators, activeDatasetId);

    if (!validation.isValid) {
      // Open the drawer for the first entity with missing mappings
      if (validation.firstInvalidRunner) {
        const runner = validation.firstInvalidRunner.runner;
        // Open runner editor with proper flow callbacks
        void openRunnerEditor(runner);
      } else if (validation.firstInvalidEvaluator) {
        const { evaluator, runnerId } = validation.firstInvalidEvaluator;
        const runner = runners.find((r) => r.id === runnerId);

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
        if (runner) {
          availableSources.push({
            id: runner.id,
            name: runner.name,
            type: "signature" as const,
            fields: runner.outputs.map((o) => ({
              name: o.identifier,
              type: o.type as "str" | "float" | "bool",
            })),
          });
        }

        const storeMappings = evaluator.mappings[activeDatasetId]?.[runnerId] ?? {};
        const initialMappings: Record<string, UIFieldMapping> = {};
        for (const [key, mapping] of Object.entries(storeMappings)) {
          initialMappings[key] = convertToUIMapping(mapping);
        }

        const mappingsConfig = {
          availableSources,
          initialMappings,
          onMappingChange: (identifier: string, mapping: UIFieldMapping | undefined) => {
            if (mapping) {
              const storeMapping = convertFromUIMapping(mapping, isDatasetSource);
              setEvaluatorMapping(evaluator.id, activeDatasetId, runnerId, identifier, storeMapping);
            } else {
              removeEvaluatorMapping(evaluator.id, activeDatasetId, runnerId, identifier);
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
    if (!hasRunners) {
      return "Click to add a runner";
    }
    const validation = validateWorkbench(runners, evaluators, activeDatasetId);
    if (!validation.isValid) {
      if (validation.firstInvalidRunner) {
        return `Configure missing mappings for "${validation.firstInvalidRunner.runner.name}"`;
      }
      if (validation.firstInvalidEvaluator) {
        return `Configure missing mappings for evaluator`;
      }
    }
    return "Run evaluation on all runners";
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

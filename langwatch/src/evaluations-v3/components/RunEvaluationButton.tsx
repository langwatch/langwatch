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
import { validateWorkbench } from "../utils/mappingValidation";

type RunEvaluationButtonProps = {
  /** Whether the button is disabled (e.g., while loading) */
  disabled?: boolean;
};

export const RunEvaluationButton = ({
  disabled = false,
}: RunEvaluationButtonProps) => {
  const { openDrawer } = useDrawer();

  const { runners, evaluators, activeDatasetId } = useEvaluationsV3Store(
    useShallow((state) => ({
      runners: state.runners,
      evaluators: state.evaluators,
      activeDatasetId: state.activeDatasetId,
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
        // Open prompt editor drawer for this runner
        if (runner.type === "prompt") {
          openDrawer("promptEditor", {
            promptId: runner.promptId,
            initialLocalConfig: runner.localPromptConfig,
            urlParams: { runnerId: runner.id },
          });
        }
        // TODO: Handle agent type runners
      } else if (validation.firstInvalidEvaluator) {
        // TODO: Open evaluator drawer
        console.log("First invalid evaluator:", validation.firstInvalidEvaluator);
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
        colorPalette="green"
        onClick={handleClick}
        disabled={disabled}
        data-testid="run-evaluation-button"
      >
        <LuPlay size={14} />
        Run Evaluation
      </Button>
    </Tooltip>
  );
};

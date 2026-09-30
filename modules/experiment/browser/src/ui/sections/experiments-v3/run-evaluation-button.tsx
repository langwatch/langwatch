/**
 * Global "Run Evaluation" button with validation.
 */

import { Button, Spinner } from "@chakra-ui/react";
import { useDrawer } from "@langwatch/browser-host/drawer";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { validateWorkbench } from "@langwatch/experiment-contract/mapping-validation";
import { LuPlay, LuSquare } from "react-icons/lu";
import { useShallow } from "zustand/react/shallow";

import { useEvaluationsV3Store } from "../../../behavior/experiments-v3/use-evaluations-v3-store.ts";
import { useExecuteEvaluation } from "../../../behavior/experiments-v3/use-execute-evaluation.ts";
import { useOpenEvaluatorMappings } from "../../../behavior/experiments-v3/use-open-evaluator-mappings.ts";
import { useOpenTargetEditor } from "../../../behavior/experiments-v3/use-open-target-editor.ts";
import { usePromptTemplateFields } from "../../../behavior/experiments-v3/use-prompt-template-fields.ts";

type RunEvaluationButtonProps = {
  /** Whether the button is disabled (e.g., while loading) */
  disabled?: boolean;
};

/** What the button reads while the evaluation is idle, running or stopping. */
function RunButtonLabel({ isAborting, isRunning }: { isAborting: boolean; isRunning: boolean }) {
  if (isAborting) {
    return (
      <>
        <Spinner size="xs" />
        Stopping...
      </>
    );
  }
  if (isRunning) {
    return (
      <>
        <LuSquare size={14} />
        Stop
      </>
    );
  }

  return (
    <>
      <LuPlay size={14} />
      Run
    </>
  );
}

/** Why the button reads what it does: stopping, stopping soon, a gap to fill, or ready. */
const runTooltipOf = ({
  isAborting,
  isRunning,
  hasTargets,
  validation,
}: {
  isAborting: boolean;
  isRunning: boolean;
  hasTargets: boolean;
  validation: () => { firstInvalidTarget?: unknown; firstInvalidEvaluator?: unknown };
}) => {
  if (isAborting) return "Stopping evaluation...";
  if (isRunning) return "Stop evaluation";
  if (!hasTargets) return "Click to add a target";
  const { firstInvalidTarget, firstInvalidEvaluator } = validation();
  if (firstInvalidTarget) return "Configure missing mappings for target";
  if (firstInvalidEvaluator) return "Configure missing mappings for evaluator";
  return "Run evaluation on all targets";
};

export const RunEvaluationButton = ({ disabled = false }: RunEvaluationButtonProps) => {
  const { openDrawer } = useDrawer();
  const { openTargetEditor } = useOpenTargetEditor();
  const openEvaluatorMappings = useOpenEvaluatorMappings();
  const promptTemplateFields = usePromptTemplateFields();
  const { status, execute, abort, isAborting } = useExecuteEvaluation();

  const { targets, evaluators, activeDatasetId, results } = useEvaluationsV3Store(
    useShallow((state) => ({
      targets: state.targets,
      evaluators: state.evaluators,
      activeDatasetId: state.activeDatasetId,
      results: state.results,
    })),
  );

  const hasTargets = targets.length > 0;
  const isRunning = status === "running" || results.status === "running";
  const validate = () =>
    validateWorkbench({ targets, evaluators, activeDatasetId, promptTemplateFields });

  const handleClick = async () => {
    if (isRunning) return abort();
    if (!hasTargets) return openDrawer("targetTypeSelector", {});
    const validation = validate();
    if (validation.isValid) return execute({ type: "full" });
    // Open the drawer for the first entity with missing mappings.
    if (validation.firstInvalidTarget) {
      void openTargetEditor(validation.firstInvalidTarget.target);
    } else if (validation.firstInvalidEvaluator) {
      openEvaluatorMappings(validation.firstInvalidEvaluator);
    }
  };

  return (
    <Tooltip
      content={runTooltipOf({ isAborting, isRunning, hasTargets, validation: validate })}
      positioning={{ placement: "bottom" }}
      openDelay={200}
    >
      <Button
        size="sm"
        colorPalette="blue"
        variant="solid"
        onClick={handleClick}
        disabled={disabled || isAborting}
        data-testid="run-evaluation-button"
      >
        <RunButtonLabel isAborting={isAborting} isRunning={isRunning} />
      </Button>
    </Tooltip>
  );
};

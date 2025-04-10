import { Button } from "@chakra-ui/react";
import { LuCirclePlay } from "react-icons/lu";
import { useRunEvalution } from "../hooks/useRunEvalution";
import { useStepCompletedValue } from "../hooks/useStepCompletedValue";

/**
 * This is a stateless button
 */
function RunTrialButtonUI({
  runEvaluation,
  isLoading,
  trialDisabled,
}: {
  runEvaluation: () => void;
  isLoading: boolean;
  trialDisabled: boolean;
}) {
  return (
    <Button
      colorPalette="blue"
      _icon={{
        minWidth: "18px",
        minHeight: "18px",
      }}
      onClick={runEvaluation}
      loading={isLoading}
      disabled={trialDisabled}
    >
      <LuCirclePlay />
      Run Trial Evaluation
    </Button>
  );
}

/**
 * This is a stateful component is used to run a trial evaluation.
 * @returns A button to run a trial evaluation.
 */
export function RunTrialButton() {
  const { runEvaluation, isLoading } = useRunEvalution();
  const stepCompletedValue = useStepCompletedValue();
  const trialDisabled = !stepCompletedValue("all");

  return (
    <RunTrialButtonUI
      runEvaluation={runEvaluation}
      isLoading={isLoading}
      trialDisabled={trialDisabled}
    />
  );
}

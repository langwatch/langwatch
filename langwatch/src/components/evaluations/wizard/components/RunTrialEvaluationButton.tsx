import { Button, type ButtonProps } from "@chakra-ui/react";
import { useRunEvalution } from "../hooks/useRunEvalution";
import { useStepCompletedValue } from "../hooks/useStepCompletedValue";
import { LuCirclePlay } from "react-icons/lu";

/**
 * This is a stateful component is used to run a trial evaluation.
 * @returns A button to run a trial evaluation.
 */
export function RunEvaluationButton({ children, ...props }: ButtonProps) {
  const { runEvaluation, isLoading } = useRunEvalution();
  const stepCompletedValue = useStepCompletedValue();
  const trialDisabled = !stepCompletedValue("all");

  return (
    <Button
      _icon={{
        minWidth: "18px",
        minHeight: "18px",
      }}
      onClick={runEvaluation}
      loading={isLoading}
      disabled={trialDisabled}
      {...props}
    >
      <LuCirclePlay />
      {children}
    </Button>
  );
}

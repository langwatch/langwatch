import { Button, type ButtonProps } from "@chakra-ui/react";
import { useRunEvalution } from "../hooks/useRunEvalution";
import { useStepCompletedValue } from "../hooks/useStepCompletedValue";
import { LuCirclePlay } from "react-icons/lu";
import { useEvaluationWizardStore } from "../hooks/evaluation-wizard-store/useEvaluationWizardStore";
import { useShallow } from "zustand/react/shallow";
import { useModelProviderKeys } from "../../../../optimization_studio/hooks/useModelProviderKeys";
import { Tooltip } from "../../../ui/tooltip";

/**
 * This is a stateful component is used to run a trial evaluation.
 * @returns A button to run a trial evaluation.
 */
export function RunEvaluationButton({
  children,
  ...props
}: Omit<ButtonProps, "onClick">) {
  const { getDSL } = useEvaluationWizardStore(
    useShallow((state) => ({
      getDSL: state.getDSL,
    }))
  );
  const { runEvaluation, isLoading } = useRunEvalution();

  const stepCompletedValue = useStepCompletedValue();
  const { hasProvidersWithoutCustomKeys } = useModelProviderKeys({
    workflow: getDSL(),
  });
  const trialDisabled = !stepCompletedValue("all")
    ? "Complete all the previous steps to run the evaluation"
    : hasProvidersWithoutCustomKeys
    ? "Add your API keys to run the evaluation"
    : undefined;

  return (
    <Tooltip
      content={trialDisabled}
      positioning={{
        placement: "top",
      }}
    >
      <Button
        {...props}
        _icon={{
          minWidth: props._icon?.minWidth ?? "18px",
          minHeight: props._icon?.minHeight ?? "18px",
        }}
        loading={props.loading ?? isLoading}
        disabled={props.disabled ?? !!trialDisabled}
        onClick={() => {
          void runEvaluation();
        }}
      >
        <LuCirclePlay />
        {children}
      </Button>
    </Tooltip>
  );
}

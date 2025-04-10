import { Button } from "@chakra-ui/react";
import { LuCirclePlay } from "react-icons/lu";

export function RunTrialButton({
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

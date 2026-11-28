import { Dialog } from "@langwatch/design-system/dialog";
import { Text, VStack } from "@langwatch/design-system/primitives";

import {
  type JudgeTraceWaitInput,
  judgeTraceWaitErrorsOf,
  judgeTraceWaitProblemOf,
} from "../../../model/judge-trace-wait.ts";
import { JudgeTraceWaitSettings } from "../../elements/judge-trace-wait-settings.tsx";
import { SimulationModelSelect } from "./simulation-model-select.tsx";

/**
 * Shown after the user picks a target in the scenario "Save and run" flow. Lets them
 * choose the user-simulator and judge models for the run; they default to the project's
 * Default and Judge models (the scenarios.user_simulator / scenarios.judge resolution).
 */
export function ScenarioRunModelDialog({
  open,
  onOpenChange,
  simulatorModel,
  judgeModel,
  onSimulatorChange,
  onJudgeChange,
  traceWait,
  onTraceWaitChange,
  onConfirm,
  isRunning,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  simulatorModel: string | null;
  judgeModel: string | null;
  onSimulatorChange: (value: string | null) => void;
  onJudgeChange: (value: string | null) => void;
  traceWait: JudgeTraceWaitInput;
  onTraceWaitChange: (value: JudgeTraceWaitInput) => void;
  onConfirm: () => void;
  isRunning: boolean;
}) {
  return (
    <Dialog
      open={open}
      onClose={() => onOpenChange(false)}
      title="Choose models for this run"
      size="md"
      primaryAction={{
        label: "Save and run",
        loading: isRunning,
        // A refused input says why under itself, so the run waits for it.
        onClick: () => {
          if (!judgeTraceWaitProblemOf(traceWait)) onConfirm();
        },
      }}
    >
      <VStack gap={4} align="stretch">
        <Text fontSize="sm" color="fg.muted">
          Pick the model that role-plays the user and the model that judges the run. They default to
          your project&apos;s Default and Judge models.
        </Text>
        <SimulationModelSelect
          label="User simulator"
          featureKey="scenarios.user_simulator"
          value={simulatorModel}
          onChange={onSimulatorChange}
        />
        <SimulationModelSelect
          label="Judge"
          featureKey="scenarios.judge"
          value={judgeModel}
          onChange={onJudgeChange}
        />
        <JudgeTraceWaitSettings
          value={traceWait}
          errors={judgeTraceWaitErrorsOf(traceWait)}
          onChange={onTraceWaitChange}
        />
      </VStack>
    </Dialog>
  );
}

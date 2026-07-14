import { Button, Text, VStack } from "@chakra-ui/react";
import { Dialog } from "../ui/dialog";
import { SimulationModelSelect } from "./SimulationModelSelect";

/**
 * Shown after the user picks a target in the scenario "Save and run" flow.
 * Lets them choose the user-simulator and judge models for the run; both
 * default to the project's Default model (the scenarios.user_simulator /
 * scenarios.judge resolution). Confirming saves the scenario with these
 * choices and runs it.
 */
export function ScenarioRunModelDialog({
  open,
  onOpenChange,
  simulatorModel,
  judgeModel,
  onSimulatorChange,
  onJudgeChange,
  onConfirm,
  isRunning,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  simulatorModel: string | null;
  judgeModel: string | null;
  onSimulatorChange: (value: string | null) => void;
  onJudgeChange: (value: string | null) => void;
  onConfirm: () => void;
  isRunning: boolean;
}) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(details) => onOpenChange(details.open)}
    >
      <Dialog.Content bg="bg">
        <Dialog.Header>
          <Dialog.Title>Choose models for this run</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <VStack gap={4} align="stretch">
            <Text fontSize="sm" color="fg.muted">
              Pick the model that role-plays the user and the model that judges
              the run. Both default to your project&apos;s Default model.
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
          </VStack>
        </Dialog.Body>
        <Dialog.Footer>
          <Dialog.ActionTrigger asChild>
            <Button variant="outline">Cancel</Button>
          </Dialog.ActionTrigger>
          <Button colorPalette="blue" loading={isRunning} onClick={onConfirm}>
            Save and run
          </Button>
        </Dialog.Footer>
        <Dialog.CloseTrigger />
      </Dialog.Content>
    </Dialog.Root>
  );
}

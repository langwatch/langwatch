import { Button, Checkbox, HStack, Text, VStack } from "@chakra-ui/react";
import { Play } from "lucide-react";
import { useState } from "react";
import { Dialog } from "../ui/dialog";
import { TargetSelector, type TargetValue } from "./TargetSelector";

interface RunScenarioModalProps {
  open: boolean;
  onClose: () => void;
  onRun: (target: TargetValue, remember: boolean) => void;
  initialTarget?: TargetValue;
  isLoading?: boolean;
}

/**
 * Modal for selecting a target to run a scenario against.
 * Used on the scenario run page when no target is persisted.
 */
export function RunScenarioModal({
  open,
  onClose,
  onRun,
  initialTarget = null,
  isLoading = false,
}: RunScenarioModalProps) {
  const [selectedTarget, setSelectedTarget] =
    useState<TargetValue>(initialTarget);
  const [rememberSelection, setRememberSelection] = useState(true);

  const handleRun = () => {
    if (selectedTarget) {
      onRun(selectedTarget, rememberSelection);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(e) => !e.open && onClose()}>
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>Run Scenario</Dialog.Title>
        </Dialog.Header>
        <Dialog.CloseTrigger />
        <Dialog.Body>
          <VStack gap={4} align="stretch">
            <Text>Select a target to run this scenario:</Text>
            <TargetSelector
              value={selectedTarget}
              onChange={setSelectedTarget}
            />
            <Checkbox.Root
              checked={rememberSelection}
              onCheckedChange={(e) => setRememberSelection(!!e.checked)}
            >
              <Checkbox.HiddenInput />
              <Checkbox.Control />
              <Checkbox.Label>Remember this selection</Checkbox.Label>
            </Checkbox.Root>
          </VStack>
        </Dialog.Body>
        <Dialog.Footer>
          <HStack gap={2}>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              colorPalette="blue"
              onClick={handleRun}
              disabled={!selectedTarget}
              loading={isLoading}
            >
              <Play size={14} />
              Run
            </Button>
          </HStack>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}

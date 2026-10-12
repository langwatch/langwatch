import { RawCheckbox as Checkbox } from "@langwatch/design-system/checkbox";
import { Dialog } from "@langwatch/design-system/dialog";
import { Text, VStack } from "@langwatch/design-system/primitives";
import { Play } from "lucide-react";
import { useState } from "react";

import type { TargetValue } from "../../../model/scenario-target.ts";
import { TargetSelector } from "./target-selector.tsx";

interface RunScenarioModalProps {
  open: boolean;
  onClose: () => void;
  onRun: (target: TargetValue, shouldRemember: boolean) => void;
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
  const [selectedTarget, setSelectedTarget] = useState<TargetValue>(initialTarget);
  const [rememberSelection, setRememberSelection] = useState(true);
  const [hasTriedWithoutTarget, setHasTriedWithoutTarget] = useState(false);

  const handleRun = () => {
    if (!selectedTarget) {
      setHasTriedWithoutTarget(true);
      return;
    }
    onRun(selectedTarget, rememberSelection);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Run scenario"
      data-testid="run-scenario-modal"
      size="md"
      primaryAction={{
        label: "Run",
        icon: <Play size={14} />,
        loading: isLoading,
        onClick: handleRun,
      }}
    >
      <VStack gap={4} align="stretch">
        <Text>Select a target to run this scenario:</Text>
        <TargetSelector value={selectedTarget} onChange={setSelectedTarget} />
        {hasTriedWithoutTarget && !selectedTarget && (
          <Text textStyle="caption" color="red.fg" role="alert">
            Choose an agent or prompt to run this scenario against.
          </Text>
        )}
        <Checkbox.Root
          checked={rememberSelection}
          onCheckedChange={(e) => setRememberSelection(!!e.checked)}
        >
          <Checkbox.HiddenInput />
          <Checkbox.Control />
          <Checkbox.Label>Remember this selection</Checkbox.Label>
        </Checkbox.Root>
      </VStack>
    </Dialog>
  );
}

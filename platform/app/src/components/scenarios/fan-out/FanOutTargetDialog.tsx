import { Button, Text, VStack } from "@chakra-ui/react";
import { useState } from "react";
import { Dialog } from "../../ui/dialog";
import type { FanOutTarget } from "../services/fanOutGeneration";
import { TargetSelector, type TargetValue } from "../TargetSelector";

/**
 * Asks which agent or prompt the generated scenarios should run against.
 *
 * A scenario carries no target of its own (it is picked at run time), so a
 * seed that didn't come from an existing run has nothing to inherit. Rather
 * than guess, ask once before generating.
 *
 * See specs/scenarios/adjacent-scenario-generation.feature
 * ("A run with no recorded target type still offers the entry point").
 */
export function FanOutTargetDialog({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (target: FanOutTarget) => void;
}) {
  const [target, setTarget] = useState<TargetValue>(null);

  return (
    <Dialog.Root open={open} onOpenChange={({ open }) => !open && onClose()}>
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>What should these scenarios test?</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <VStack align="stretch" gap={3}>
            <Text textStyle="sm" color="fg.muted">
              Pick the agent or prompt the generated scenarios will run against.
            </Text>
            <TargetSelector value={target} onChange={setTarget} />
          </VStack>
        </Dialog.Body>
        <Dialog.Footer>
          <Button
            colorPalette="orange"
            disabled={!target}
            onClick={() => {
              if (!target) return;
              onConfirm({ type: target.type, referenceId: target.id });
            }}
          >
            Continue
          </Button>
        </Dialog.Footer>
        <Dialog.CloseTrigger />
      </Dialog.Content>
    </Dialog.Root>
  );
}

/**
 * The Run button at the end of a test case row.
 *
 * The button opens a small dialog that asks which agent to run against, with
 * the agent of the last run already chosen. Confirming starts the run and
 * leaves the person where they are.
 *
 * @see specs/features/agent-testing/cases-table.feature
 * @see specs/features/agent-testing/live-one-off-run.feature
 */

import { Button, HStack, Text, VStack } from "@chakra-ui/react";
import { Play } from "lucide-react";
import { useEffect, useState } from "react";
import {
  TargetSelector,
  type TargetValue,
} from "~/components/scenarios/TargetSelector";
import { Popover } from "~/components/ui/popover";

export type RunCaseButtonProps = {
  caseName: string;
  /** The agent the last run of this case used, already chosen. */
  initialTarget: TargetValue;
  isRunning?: boolean;
  disabled?: boolean;
  onRun: (target: TargetValue) => void;
};

export function RunCaseButton({
  caseName,
  initialTarget,
  isRunning = false,
  disabled = false,
  onRun,
}: RunCaseButtonProps) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<TargetValue>(initialTarget);

  useEffect(() => {
    if (initialTarget) setTarget(initialTarget);
  }, [initialTarget]);

  return (
    <Popover.Root
      open={open}
      onOpenChange={(event) => setOpen(event.open)}
      positioning={{ placement: "bottom-end" }}
      lazyMount
      unmountOnExit
    >
      <Popover.Trigger asChild>
        <Button
          size="xs"
          variant="outline"
          loading={isRunning}
          disabled={disabled}
          aria-label={`Run ${caseName}`}
          onClick={(event) => event.stopPropagation()}
        >
          <Play size={12} />
          Run
        </Button>
      </Popover.Trigger>
      <Popover.Content
        width="340px"
        onClick={(event) => event.stopPropagation()}
        data-testid="run-case-dialog"
      >
        <Popover.Body>
          <VStack align="stretch" gap={3}>
            <Text fontSize="sm" fontWeight="medium">
              Agent to be tested
            </Text>
            <TargetSelector value={target} onChange={setTarget} />
            <HStack justify="flex-end">
              <Button
                size="xs"
                colorPalette="blue"
                disabled={!target}
                onClick={() => {
                  setOpen(false);
                  onRun(target);
                }}
              >
                <Play size={12} />
                Start run
              </Button>
            </HStack>
          </VStack>
        </Popover.Body>
      </Popover.Content>
    </Popover.Root>
  );
}

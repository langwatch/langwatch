/**
 * The two actions of the run dialog: leave it, or queue the run.
 * @see specs/features/agent-testing/run-dialog.feature
 */

import { Box, chakra, Text } from "@chakra-ui/react";
import { Play } from "lucide-react";
import { useId } from "react";
import { Dialog } from "@langwatch/design-system/studio-dialog";
import { FG_MUTED, QUIET_BUTTON_SHADOW } from "../../../../model/agent-testing/shared/design";
import { SmallButton } from "../../../elements/agent-testing/shared/small-button";
import type { RunDialogController } from "./use-run-dialog-submit";

/**
 * What the run control reads, given how many scenarios the subject covers
 * and, in a comparison, how many targets it goes against.
 */
export function runButtonLabel({
  caseCount,
  targetCount,
}: {
  caseCount: number | null;
  targetCount: number;
}): string {
  if (caseCount === null) return "Run";
  const scenarios = caseCount === 1 ? "Run 1 scenario" : `Run ${caseCount} scenarios`;
  return targetCount > 1 ? `${scenarios} × ${targetCount} targets` : scenarios;
}

export function RunDialogFooter({
  controller,
  isRunBlocked,
  caseCount,
  targetCount,
  blockedReason,
  onClose,
}: {
  controller: RunDialogController;
  isRunBlocked: boolean;
  /** How many scenarios the run covers, or nothing when it is not known. */
  caseCount: number | null;
  /** How many targets the run goes against. */
  targetCount: number;
  /** Why the run cannot start, when it cannot. Printed beside the button. */
  blockedReason: string | null;
  onClose: () => void;
}) {
  const reasonId = useId();
  const reason = isRunBlocked && blockedReason ? blockedReason : null;
  return (
    <Dialog.Footer borderTopWidth="1px" borderColor="border" paddingX={5} paddingY={3} gap={2}>
      {reason ? (
        <Text
          id={reasonId}
          fontSize="12px"
          color={FG_MUTED}
          data-testid="run-dialog-blocked-reason"
        >
          {reason}
        </Text>
      ) : null}
      <Box flex={1} />
      <chakra.button
        type="button"
        onClick={onClose}
        disabled={controller.isBusy}
        paddingX={3}
        height="28px"
        borderRadius="lg"
        fontSize="12px"
        fontWeight="medium"
        color={FG_MUTED}
        cursor="pointer"
        boxShadow={QUIET_BUTTON_SHADOW}
        _hover={{ background: "bg.muted", color: "fg" }}
        _disabled={{ cursor: "not-allowed", opacity: 0.5 }}
      >
        Cancel
      </chakra.button>
      <SmallButton
        variant="solid"
        colorPalette="blue"
        disabled={isRunBlocked}
        loading={controller.isBusy}
        onClick={() => void controller.run()}
        data-testid="run-dialog-run"
        aria-describedby={reason ? reasonId : undefined}
      >
        <Play size={13} />
        {runButtonLabel({ caseCount, targetCount })}
      </SmallButton>
    </Dialog.Footer>
  );
}

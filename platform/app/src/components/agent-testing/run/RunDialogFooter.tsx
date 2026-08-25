/**
 * The three actions of the run dialog: leave it, write the target down, or
 * queue the run.
 *
 * Only the run is solid: it is the one thing the dialog is open for, and it
 * names how many test cases it starts.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 */

import { Box, chakra } from "@chakra-ui/react";
import { Play } from "lucide-react";
import { Dialog } from "~/components/ui/dialog";
import { FG_MUTED, QUIET_BUTTON_SHADOW } from "../shared/design";
import { SmallButton } from "../shared/SmallButton";
import type { RunDialogController } from "./useRunDialogSubmit";

/** What the run control reads, given how many cases the subject covers. */
export function runButtonLabel(caseCount: number | null): string {
  if (caseCount === null) return "Run";
  return caseCount === 1 ? "Run 1 case" : `Run ${caseCount} cases`;
}

export function RunDialogFooter({
  controller,
  hasTarget,
  isRunBlocked,
  caseCount,
  onClose,
}: {
  controller: RunDialogController;
  hasTarget: boolean;
  isRunBlocked: boolean;
  /** How many test cases the run covers, or nothing when it is not known. */
  caseCount: number | null;
  onClose: () => void;
}) {
  return (
    <Dialog.Footer
      borderTopWidth="1px"
      borderColor="border"
      paddingX={5}
      paddingY={3}
      gap={2}
    >
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
        disabled={!hasTarget || controller.isBusy}
        loading={controller.isSaving}
        onClick={() => void controller.save()}
      >
        Save
      </SmallButton>
      <SmallButton
        variant="solid"
        colorPalette="blue"
        background={undefined}
        borderColor="transparent"
        disabled={isRunBlocked}
        loading={controller.isRunning}
        onClick={() => void controller.run()}
        data-testid="run-dialog-run"
      >
        <Play size={13} />
        {runButtonLabel(caseCount)}
      </SmallButton>
    </Dialog.Footer>
  );
}

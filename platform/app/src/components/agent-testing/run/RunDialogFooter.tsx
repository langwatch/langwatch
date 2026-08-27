/**
 * The two actions of the run dialog: leave it, or queue the run.
 *
 * Only the run is solid: it is the one thing the dialog is open for, and it
 * names how many scenarios it starts. A run plan is a name and a
 * configuration, and running is what writes both down, so there is nothing to
 * save on its own.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 */

import { Box, chakra } from "@chakra-ui/react";
import { Play } from "lucide-react";
import { Dialog } from "~/components/ui/dialog";
import { Tooltip } from "~/components/ui/tooltip";
import { FG_MUTED, QUIET_BUTTON_SHADOW } from "../shared/design";
import { SmallButton } from "../shared/SmallButton";
import type { RunDialogController } from "./useRunDialogSubmit";

/** What the run control reads, given how many cases the subject covers. */
export function runButtonLabel(caseCount: number | null): string {
  if (caseCount === null) return "Run";
  return caseCount === 1 ? "Run 1 scenario" : `Run ${caseCount} scenarios`;
}

export function RunDialogFooter({
  controller,
  isRunBlocked,
  caseCount,
  blockedReason,
  onClose,
}: {
  controller: RunDialogController;
  isRunBlocked: boolean;
  /** How many scenarios the run covers, or nothing when it is not known. */
  caseCount: number | null;
  /** Why the run cannot start, when it cannot. Shown as the button tooltip. */
  blockedReason: string | null;
  onClose: () => void;
}) {
  const runButton = (
    <SmallButton
      variant="solid"
      colorPalette="blue"
      background={undefined}
      borderColor="transparent"
      disabled={isRunBlocked}
      loading={controller.isRunning}
      onClick={() => void controller.run()}
      // A disabled solid button must not brighten on hover: pointer-events
      // stay off so the hover state cannot fire at all.
      _disabled={{
        cursor: "not-allowed",
        opacity: 0.5,
        pointerEvents: "none",
      }}
      data-testid="run-dialog-run"
    >
      <Play size={13} />
      {runButtonLabel(caseCount)}
    </SmallButton>
  );
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
      {isRunBlocked && blockedReason ? (
        <Tooltip content={blockedReason}>
          {/* A disabled button never dispatches pointer events, which would
              keep the tooltip from firing; wrap it in a span so the hover
              still lands on something. */}
          <Box as="span" display="inline-flex">
            {runButton}
          </Box>
        </Tooltip>
      ) : (
        runButton
      )}
    </Dialog.Footer>
  );
}

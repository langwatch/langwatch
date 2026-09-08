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
  const scenarios =
    caseCount === 1 ? "Run 1 scenario" : `Run ${caseCount} scenarios`;
  return targetCount > 1 ? `${scenarios} × ${targetCount} targets` : scenarios;
}

export function RunDialogFooter({
  controller,
  isRunBlocked,
  caseCount,
  targetCount,
  blockedReason,
  warning,
  onRun,
  onClose,
}: {
  controller: RunDialogController;
  isRunBlocked: boolean;
  /** How many scenarios the run covers, or nothing when it is not known. */
  caseCount: number | null;
  /** How many targets the run goes against. */
  targetCount: number;
  /** Why the run cannot start, when it cannot. Shown as the button tooltip. */
  blockedReason: string | null;
  /**
   * What Run does first instead of running, when something holds it: the
   * button stays enabled and says so over the pointer.
   */
  warning?: string | null;
  /** What Run does. Defaults to queueing the run. */
  onRun?: () => void;
  onClose: () => void;
}) {
  const runButton = (
    <SmallButton
      variant="solid"
      colorPalette="blue"
      disabled={isRunBlocked}
      loading={controller.isBusy}
      onClick={onRun ?? (() => void controller.run())}
      data-testid="run-dialog-run"
      data-warning={warning ?? undefined}
    >
      <Play size={13} />
      {runButtonLabel({ caseCount, targetCount })}
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
      ) : !isRunBlocked && warning ? (
        <Tooltip content={warning}>
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

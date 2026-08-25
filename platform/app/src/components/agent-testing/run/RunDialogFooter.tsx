/**
 * The three actions of the run dialog: leave it, write the target down, or
 * queue the run.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 */

import { Button } from "@chakra-ui/react";
import { Play } from "lucide-react";
import { Dialog } from "~/components/ui/dialog";
import type { RunDialogController } from "./useRunDialogSubmit";

export function RunDialogFooter({
  controller,
  hasTarget,
  isRunBlocked,
  onClose,
}: {
  controller: RunDialogController;
  hasTarget: boolean;
  isRunBlocked: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog.Footer>
      <Button
        variant="outline"
        size="sm"
        disabled={controller.isBusy}
        onClick={onClose}
      >
        Cancel
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={!hasTarget || controller.isBusy}
        loading={controller.isSaving}
        onClick={() => void controller.save()}
      >
        Save
      </Button>
      <Button
        colorPalette="blue"
        size="sm"
        disabled={isRunBlocked}
        loading={controller.isRunning}
        onClick={() => void controller.run()}
        data-testid="run-dialog-run"
      >
        <Play size={14} />
        Run
      </Button>
    </Dialog.Footer>
  );
}

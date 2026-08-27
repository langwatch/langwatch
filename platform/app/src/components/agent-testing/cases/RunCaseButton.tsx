/**
 * The Run button at the end of a test case row.
 *
 * The button opens the run dialog for that case, with the agent of the last
 * run already chosen there. Confirming starts the run and leaves the person
 * where they are.
 *
 * @see specs/features/agent-testing/cases-table.feature
 * @see specs/features/agent-testing/run-dialog.feature
 * @see specs/features/agent-testing/live-one-off-run.feature
 */

import { Play } from "lucide-react";
import { SmallButton } from "../shared/SmallButton";

export type RunCaseButtonProps = {
  caseName: string;
  isRunning?: boolean;
  disabled?: boolean;
  onOpen: () => void;
};

export function RunCaseButton({
  caseName,
  isRunning = false,
  disabled = false,
  onOpen,
}: RunCaseButtonProps) {
  return (
    <SmallButton
      loading={isRunning}
      disabled={disabled}
      aria-label={`Run ${caseName}`}
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
    >
      <Play size={13} />
      Run
    </SmallButton>
  );
}

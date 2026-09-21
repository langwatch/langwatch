/**
 * The Run button at the end of a scenario row.
 *
 * The button opens the run dialog for that scenario, with the agent of the last
 * run already chosen there. Confirming starts the run and leaves the person
 * where they are.
 *
 * @see specs/features/agent-testing/cases-table.feature
 * @see specs/features/agent-testing/run-dialog.feature
 * @see specs/features/agent-testing/live-single-scenario-run.feature
 */

import { Play } from "lucide-react";
import { SmallButton } from "../shared/SmallButton";

export type RunCaseButtonProps = {
  caseName: string;
  disabled?: boolean;
  onOpen: () => void;
};

export function RunCaseButton({
  caseName,
  disabled = false,
  onOpen,
}: RunCaseButtonProps) {
  return (
    <SmallButton
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

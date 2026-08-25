/**
 * Write or edit one test case, in one dialog.
 *
 * The dialog asks four questions: what the case is called, which suite it
 * belongs to, what the user is trying to do, and what the judge must check.
 * Everything a run can override sits under Advanced, so the four questions
 * stay the whole form.
 *
 * @see specs/features/agent-testing/cases-table.feature
 * @see specs/features/agent-testing/case-version-history.feature
 */

import { Dialog } from "~/components/ui/dialog";
import {
  CaseModalFields,
  CaseModalFooter,
  CaseModalHeader,
} from "./CaseModalParts";
import type { TestSuiteEntry } from "./test-cases";
import type { CaseEditorState } from "./useCaseEditor";

export type CaseModalProps = {
  open: boolean;
  /** The case being edited, or nothing for a new one. */
  scenarioId: string | null;
  suites: TestSuiteEntry[];
  editor: CaseEditorState;
  onClose: () => void;
  /** Opens the version history of the case being edited. */
  onOpenHistory: () => void;
};

export function CaseModal({
  open,
  scenarioId,
  suites,
  editor,
  onClose,
  onOpenHistory,
}: CaseModalProps) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={({ open: nextOpen }) => !nextOpen && onClose()}
      placement="center"
    >
      <Dialog.Content bg="bg.panel" maxWidth="640px" data-testid="case-modal">
        <CaseModalHeader
          isEditing={!!scenarioId}
          version={editor.version}
          onOpenHistory={onOpenHistory}
        />

        <Dialog.Body paddingX={5} paddingY={4}>
          <CaseModalFields editor={editor} suites={suites} />
        </Dialog.Body>

        <CaseModalFooter editor={editor} />
      </Dialog.Content>
    </Dialog.Root>
  );
}

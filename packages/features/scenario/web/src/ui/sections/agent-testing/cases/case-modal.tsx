/**
 * Write or edit one scenario, in a right-side drawer.
 *
 * The drawer asks four questions: what the scenario is called, which suite it
 * belongs to, what the user is trying to do, and what the judge must check.
 * Everything else, the parameters, the turn limits and the model overrides,
 * waits behind a chip, so the four questions stay the whole form.
 *
 * The drawer is URL routed. Save & Run leaves the drawer through the
 * standard drawer navigation, and the page opens the run flow with the
 * saved scenario.
 *
 * @see specs/features/agent-testing/cases-table.feature
 * @see specs/features/agent-testing/case-version-history.feature
 * @see dev/docs/best_practices/drawers.md
 */

import { Drawer } from "@langwatch/workflow-web/components/ui/drawer";
import { CaseModalFields, CaseModalFooter, CaseModalHeader } from "./case-modal-parts";
import { CASE_EDITOR_DRAWER_SIZE } from "./drawer-keys";
import type { TestSuiteEntry } from "../../../../model/agent-testing/cases/test-cases";
import type { CaseEditorState } from "./use-case-editor";

export type CaseModalProps = {
  open: boolean;
  /** The scenario being edited, or nothing for a new one. */
  scenarioId: string | null;
  suites: TestSuiteEntry[];
  editor: CaseEditorState;
  onClose: () => void;
  /** True when the drawer was opened from a History entry. */
  openHistoryOnOpen?: boolean;
};

export function CaseModal({
  open,
  scenarioId,
  suites,
  editor,
  onClose,
  openHistoryOnOpen,
}: CaseModalProps) {
  return (
    <Drawer.Root
      open={open}
      onOpenChange={({ open: nextOpen }) => !nextOpen && onClose()}
      placement="end"
      size={CASE_EDITOR_DRAWER_SIZE}
    >
      <Drawer.Content bg="bg.panel" data-testid="case-modal">
        <CaseModalHeader
          isEditing={!!scenarioId}
          scenarioId={scenarioId}
          version={editor.version}
          openHistoryOnOpen={openHistoryOnOpen}
        />

        <Drawer.Body paddingX={5} paddingY={4} overflowY="auto">
          <CaseModalFields editor={editor} suites={suites} />
        </Drawer.Body>

        <CaseModalFooter editor={editor} />
      </Drawer.Content>
    </Drawer.Root>
  );
}

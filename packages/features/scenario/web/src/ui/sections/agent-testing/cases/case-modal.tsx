/**
 * @see specs/features/agent-testing/cases-table.feature
 * @see specs/features/agent-testing/case-version-history.feature
 * @see dev/docs/best_practices/drawers.md
 */

import { Drawer } from "@langwatch/design-system/studio-drawer";
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

/**
 * @see specs/features/agent-testing/cases-table.feature
 * @see specs/features/agent-testing/case-version-history.feature
 * @see dev/docs/best_practices/drawers.md
 */

import { Drawer } from "@langwatch/design-system/drawer";
import { useState } from "react";

import type { TestSuiteEntry } from "../../../../model/agent-testing/cases/test-cases.ts";
import {
  CASE_MODAL_SUBTITLE,
  CaseModalFields,
  CaseModalHeaderTools,
  caseDraftProblems,
  caseModalFooter,
} from "./case-modal-parts.tsx";
import type { CaseEditorState } from "./use-case-editor.ts";

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
  const [attempted, setAttempted] = useState(false);
  // A closed editor forgets a refused save, so a reopened one starts clean.
  if (!open && attempted) setAttempted(false);

  const save = (options: { shouldRunAfterSave: boolean }) => {
    if (editor.isSaving || editor.isLoading) return;
    if (!editor.problem) return editor.save(options);
    setAttempted(true);
    const problems = caseDraftProblems({
      draft: editor.draft,
      inlineDeclarations: editor.inlineDeclarations,
      attempted: true,
    });
    // The first field a save refused, in the order the form asks them.
    const [invalid] =
      [
        ["Title", problems.title],
        ["Situation", problems.situation],
        ["Criteria", problems.criteria],
      ].find(([, message]) => message !== undefined) ?? [];
    document
      .querySelector<HTMLElement>(`[data-testid="case-modal"] [aria-label="${invalid}"]`)
      ?.focus();
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      size="detail"
      title={scenarioId ? "Edit scenario" : "New scenario"}
      subtitle={CASE_MODAL_SUBTITLE}
      headerTools={
        scenarioId ? (
          <CaseModalHeaderTools
            scenarioId={scenarioId}
            version={editor.version}
            openHistoryOnOpen={openHistoryOnOpen}
          />
        ) : null
      }
      footer={caseModalFooter({ editor, onSave: save })}
      data-testid="case-modal"
    >
      <CaseModalFields editor={editor} suites={suites} attempted={attempted} />
    </Drawer>
  );
}

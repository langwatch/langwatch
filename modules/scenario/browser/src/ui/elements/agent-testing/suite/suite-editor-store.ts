/**
 * The suite editor's draft, kept outside the drawer: navigating to an evaluator drawer unmounts the
 * editor, and the person must come back to what they typed.
 * @see specs/features/agent-testing/suite-editor.feature
 * @see dev/docs/best_practices/drawers.md
 */

import type { EvaluatorAttachment, SuiteFieldType } from "@langwatch/scenario-contract";
import { create } from "zustand";

/** One row of the fields section. */
export type SuiteFieldRow = {
  /** A key of the row itself, stable while the row is reordered or renamed. */
  key: string;
  identifier: string;
  type: SuiteFieldType;
  /** What the editor or the server refused about this row. */
  error?: string;
};

export type SuiteDraft = {
  name: string;
  nameError?: string;
  showFields: boolean;
  fields: SuiteFieldRow[];
  /** A refusal about the fields as a whole, such as a field still in use. */
  fieldsError?: string;
  showEvaluators: boolean;
  evaluators: EvaluatorAttachment[];
  /** A refusal about the evaluators as a whole. */
  evaluatorsError?: string;
};

type SuiteEditorStore = {
  /** The suite the draft belongs to. */
  suiteId: string | null;
  draft: SuiteDraft | null;
  /**
   * An attachment to open the evaluator editor on as soon as the drawer has
   * the draft, when the editor was opened from a pill outside it. Read once.
   */
  pendingAttachmentId: string | null;
  seed: (input: { suiteId: string; draft: SuiteDraft }) => void;
  update: (change: (draft: SuiteDraft) => SuiteDraft) => void;
  setPendingAttachmentId: (attachmentId: string | null) => void;
  clear: () => void;
};

export const useSuiteEditorStore = create<SuiteEditorStore>((set) => ({
  suiteId: null,
  draft: null,
  pendingAttachmentId: null,
  seed: ({ suiteId, draft }) => set({ suiteId, draft }),
  update: (change) => set((state) => (state.draft ? { draft: change(state.draft) } : state)),
  setPendingAttachmentId: (attachmentId) => set({ pendingAttachmentId: attachmentId }),
  clear: () => set({ suiteId: null, draft: null, pendingAttachmentId: null }),
}));

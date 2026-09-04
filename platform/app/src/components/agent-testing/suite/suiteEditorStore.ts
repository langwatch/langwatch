/**
 * The draft of the suite editor, kept outside the drawer.
 *
 * Picking an evaluator and editing its mappings both navigate to another
 * drawer, which unmounts the suite editor. The draft lives here so the person
 * comes back to what they typed, and a pick made while the editor is away
 * lands on the same draft.
 *
 * @see specs/features/agent-testing/suite-editor.feature
 * @see dev/docs/best_practices/drawers.md
 */

import { create } from "zustand";
import type { EvaluatorAttachment } from "~/server/scenarios/evaluator-attachments";
import type { SuiteFieldType } from "~/server/scenarios/suite-fields";

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
  update: (change) =>
    set((state) => (state.draft ? { draft: change(state.draft) } : state)),
  setPendingAttachmentId: (attachmentId) =>
    set({ pendingAttachmentId: attachmentId }),
  clear: () => set({ suiteId: null, draft: null, pendingAttachmentId: null }),
}));

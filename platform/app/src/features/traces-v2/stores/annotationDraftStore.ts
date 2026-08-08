import { create } from "zustand";
import type {
  AnnotationMode,
  ScoreOptions,
} from "../components/TraceDrawer/conversationView/annotationForm.types";

/** What the reviewer is writing, and which turn it belongs to. */
export interface AnnotationDraft {
  traceId: string;
  mode: AnnotationMode;
  /** Set when the draft edits an annotation that already exists. */
  annotationId?: string;
  comment: string;
  expectedOutput: string;
  scoreOptions: ScoreOptions;
  /**
   * Whether an edit draft has already taken its values from the stored
   * annotation. The composer reads the annotation asynchronously, so without
   * this the seeding effect would keep firing and overwrite every keystroke.
   */
  seededFromExisting: boolean;
}

export interface OpenAnnotationDraftParams {
  traceId: string;
  mode: AnnotationMode;
  /** Opens the composer on an existing annotation instead of a new one. */
  annotationId?: string;
  /** The turn's current output, which a suggestion starts from. */
  output?: string | null;
}

interface AnnotationDraftState {
  draft: AnnotationDraft | null;
  openDraft: (params: OpenAnnotationDraftParams) => void;
  patchDraft: (
    patch: Partial<Omit<AnnotationDraft, "traceId" | "mode" | "annotationId">>,
  ) => void;
  closeDraft: () => void;
}

/**
 * The one annotation being written, wherever it is being written from.
 *
 * Two reasons this lives outside the component tree. A long conversation only
 * renders the turns on screen, so the composer is unmounted the moment the
 * reviewer scrolls past its turn, and local state would take the typed text
 * with it. And only one composer should ever be open, which a store states
 * directly instead of leaving every turn to coordinate with its siblings.
 */
export const useAnnotationDraftStore = create<AnnotationDraftState>((set) => ({
  draft: null,
  openDraft: ({ traceId, mode, annotationId, output }) =>
    set({
      draft: {
        traceId,
        mode,
        annotationId,
        comment: "",
        // A correction is an edit of what the model actually said, so the
        // field starts as that output rather than empty. Same starting point
        // the popover composer uses.
        expectedOutput: mode === "suggest" ? (output ?? "") : "",
        scoreOptions: {},
        seededFromExisting: false,
      },
    }),
  patchDraft: (patch) =>
    set((state) =>
      state.draft ? { draft: { ...state.draft, ...patch } } : state,
    ),
  closeDraft: () => set({ draft: null }),
}));

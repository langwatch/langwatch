import { create } from "zustand";

interface AnnotationCommentState {
  traceId: string | null;
  action: "new" | "edit" | null;
  annotationId: string | null;
  setCommentState: (
    state: Partial<
      Omit<AnnotationCommentState, "setCommentState" | "resetComment">
    >
  ) => void;
  resetComment: () => void;
}

export const useAnnotationCommentStore = create<AnnotationCommentState>(
  (set) => ({
    traceId: null,
    action: null,
    annotationId: null,
    setCommentState: (newState) => set((state) => ({ ...state, ...newState })),
    resetComment: () => set({ traceId: null, action: null }),
  })
);

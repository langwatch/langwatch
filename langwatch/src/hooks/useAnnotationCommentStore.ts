import { create } from "zustand";

interface AnnotationCommentState {
  isVisible: boolean;
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
    isVisible: false,
    traceId: null,
    action: null,
    annotationId: null,
    setCommentState: (newState) => set((state) => ({ ...state, ...newState })),
    resetComment: () => set({ isVisible: false, traceId: null, action: null }),
  })
);

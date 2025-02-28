import { create } from "zustand";

interface AnnotationCommentState {
  traceId: string | null;
  action: "new" | "edit" | null;
  annotationId: string | null;
  conversationHasSomeComments: boolean;
  setCommentState: (
    state: Partial<
      Omit<AnnotationCommentState, "setCommentState" | "resetComment">
    >
  ) => void;
  resetComment: () => void;
  setConversationHasSomeComments: (hasComments: boolean) => void;
}

export const useAnnotationCommentStore = create<AnnotationCommentState>(
  (set) => ({
    traceId: null,
    action: null,
    annotationId: null,
    conversationHasSomeComments: false,
    setCommentState: (newState) => set((state) => ({ ...state, ...newState })),
    resetComment: () => set({ traceId: null, action: null }),
    setConversationHasSomeComments: (hasComments) =>
      set({ conversationHasSomeComments: hasComments }),
  })
);

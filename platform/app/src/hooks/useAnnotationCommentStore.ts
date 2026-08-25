import { create } from "zustand";

interface AnnotationCommentState {
  traceId: string | null;
  action: "new" | "edit" | null;
  annotationId: string | null;
  conversationHasSomeComments: boolean;
  /**
   * The suggestion the sidebar sends along with the comment. Suggestions are
   * written in the correction popover; this carries the existing one through an
   * edit so saving a comment never wipes it.
   */
  expectedOutput: string | null;
  setCommentState: (
    state: Partial<Omit<AnnotationCommentState, "setCommentState" | "resetComment">>,
  ) => void;
  resetComment: () => void;
  setConversationHasSomeComments: (hasComments: boolean) => void;
}

export const useAnnotationCommentStore = create<AnnotationCommentState>((set) => ({
  traceId: null,
  action: null,
  annotationId: null,
  conversationHasSomeComments: false,
  expectedOutput: null,
  setCommentState: (newState) => set((state) => ({ ...state, ...newState })),
  resetComment: () =>
    set({
      traceId: null,
      action: null,
      expectedOutput: null,
    }),
  setConversationHasSomeComments: (hasComments) =>
    set({ conversationHasSomeComments: hasComments }),
}));

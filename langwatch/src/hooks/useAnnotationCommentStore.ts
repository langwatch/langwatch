import { create } from "zustand";

interface AnnotationCommentState {
  traceId: string | null;
  action: "new" | "edit" | null;
  annotationId: string | null;
  conversationHasSomeComments: boolean;
  expectedOutputAction: "new" | "edit" | null;
  expectedOutput: string | null;
  setCommentState: (
    state: Partial<
      Omit<AnnotationCommentState, "setCommentState" | "resetComment">
    >
  ) => void;
  resetComment: () => void;
  setConversationHasSomeComments: (hasComments: boolean) => void;
  setExpectedOutput: (expectedOutput: string) => void;
}

export const useAnnotationCommentStore = create<AnnotationCommentState>(
  (set) => ({
    traceId: null,
    action: null,
    annotationId: null,
    conversationHasSomeComments: false,
    expectedOutputAction: null,
    expectedOutput: null,
    setCommentState: (newState) => set((state) => ({ ...state, ...newState })),
    resetComment: () =>
      set({
        traceId: null,
        action: null,
        expectedOutputAction: null,
        expectedOutput: null,
      }),
    setConversationHasSomeComments: (hasComments) =>
      set({ conversationHasSomeComments: hasComments }),
    setExpectedOutput: (expectedOutput: string) => set({ expectedOutput }),
  })
);

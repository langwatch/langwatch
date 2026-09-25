import { create } from "zustand";

/**
 * How a turn's trace came to be counted into the session.
 */
export type SessionMark = "auto" | "on" | "off";

interface AnnotationQueueSessionState {
  /** Whether a queue is being walked right now. */
  active: boolean;
  /** Which traces the sitting counts, and how each came to be counted. */
  marks: Record<string, SessionMark>;
  /** Where the end-of-queue hand-off to a dataset has got to. */
  handoff: "idle" | "open" | "added";
  setActive: (active: boolean) => void;
  /** Counts the trace of the turn the walk has just brought the reviewer to. */
  noteWalked: (traceId: string) => void;
  /** Counts the trace of a turn that was just annotated. */
  noteAnnotationSaved: (traceId: string) => void;
  /** Counts a trace in or out because the reviewer said so. */
  toggle: (traceId: string) => void;
  noteHandoffOpened: () => void;
  noteHandoffAdded: () => void;
  resetHandoff: () => void;
}

/**
 * The traces one sitting at the queue has collected.
 */
export const useAnnotationQueueSessionStore = create<AnnotationQueueSessionState>((set) => ({
  active: false,
  marks: {},
  handoff: "idle",
  setActive: (active) => set(active ? { active } : { active, marks: {}, handoff: "idle" }),
  noteWalked: (traceId) =>
    set((state) =>
      // Only a trace the sitting has never heard of: walking back to a turn
      // the reviewer unticked, or ticked by hand, says nothing new about it.
      state.marks[traceId] === void 0 ? { marks: { ...state.marks, [traceId]: "auto" } } : state,
    ),
  noteAnnotationSaved: (traceId) =>
    set((state) =>
      state.marks[traceId] === "off" ? state : { marks: { ...state.marks, [traceId]: "auto" } },
    ),
  toggle: (traceId) =>
    set((state) => ({
      marks: {
        ...state.marks,
        [traceId]: isSessionMarked(state.marks, traceId) ? "off" : "on",
      },
    })),
  noteHandoffOpened: () => set({ handoff: "open" }),
  noteHandoffAdded: () => set({ handoff: "added" }),
  resetHandoff: () => set({ handoff: "idle" }),
}));

/** The traces the sitting counts, in the order they were counted. */
export function sessionTraceIds(marks: Record<string, SessionMark>): string[] {
  return Object.entries(marks)
    .filter(([, mark]) => mark === "auto" || mark === "on")
    .map(([traceId]) => traceId);
}

/** Whether this trace is one the sitting counts. */
export function isSessionMarked(marks: Record<string, SessionMark>, traceId: string): boolean {
  const mark = marks[traceId];
  return mark === "auto" || mark === "on";
}

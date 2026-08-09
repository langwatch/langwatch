import { create } from "zustand";

/**
 * How a turn's trace came to be counted into the session.
 *
 * "auto" is the trace of a turn the reviewer annotated, counted because
 * annotating it is what the sitting is for. "on" and "off" are the reviewer
 * saying so themselves, which is why an "off" is not undone by a later
 * annotation: a deliberate untick outranks a rule of thumb.
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
 *
 * Which traces to hand to a dataset is a decision about the sitting the
 * reviewer is in, so it lives outside the pages that come and go as the queue
 * is walked and is dropped the moment the queue is left. A set carried over
 * from last week silently feeding a dataset would be worse than re-ticking.
 */
export const useAnnotationQueueSessionStore =
  create<AnnotationQueueSessionState>((set) => ({
    active: false,
    marks: {},
    handoff: "idle",
    setActive: (active) =>
      set(active ? { active } : { active, marks: {}, handoff: "idle" }),
    noteAnnotationSaved: (traceId) =>
      set((state) =>
        state.marks[traceId] === "off"
          ? state
          : { marks: { ...state.marks, [traceId]: "auto" } },
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
export function isSessionMarked(
  marks: Record<string, SessionMark>,
  traceId: string,
): boolean {
  const mark = marks[traceId];
  return mark === "auto" || mark === "on";
}

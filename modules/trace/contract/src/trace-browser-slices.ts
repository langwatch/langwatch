/**
 * Trace state other modules read, held in the global UI store under `trace:`.
 * Trace writes it; any module reads it (ARCHITECTURE §10.2).
 */

export const TRACE_ANNOTATION_QUEUE_SESSION_SLICE = "trace:annotation-queue-session";
export const TRACE_EXPLORER_SCOPE_SLICE = "trace:explorer-scope";

/**
 * How a turn's trace came to be counted into the session.
 */
export type SessionMark = "auto" | "on" | "off";

export interface AnnotationQueueSessionState {
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

type SetSession = (
  update:
    | Partial<AnnotationQueueSessionState>
    | ((state: AnnotationQueueSessionState) => Partial<AnnotationQueueSessionState>),
) => void;

/** The transitions of one sitting, for the slice's owner and for a test standing in for it. */
export function createAnnotationQueueSession(set: SetSession): AnnotationQueueSessionState {
  return {
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
  };
}

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

/** The cap on "select all matching", which the export endpoint enforces too. */
export const SELECT_ALL_MATCHING_CAP = 10_000;

/** The whole Explorer view as one chip an agent can be handed. */
export type TraceViewContextChip = {
  id: string;
  kind: "filter";
  label: string;
  /** Self-describing text: the scope in words, with exact timestamps. */
  ref: string;
};

/** What the Explorer publishes for other modules: its search, selection, view and link lens. */
export interface TraceExplorerScopeState {
  queryText: string;
  selectionMode: "explicit" | "all-matching";
  selectedTraceIds: Set<string>;
  viewChip: TraceViewContextChip;
  /** The lens a link into the Explorer should open, or none for the default lens. */
  linkLensId: string | undefined;
}

const nothing = (): void => {};

/** What a reader sees where trace is not installed. */
export const ANNOTATION_QUEUE_SESSION_ABSENT: AnnotationQueueSessionState = {
  active: false,
  marks: {},
  handoff: "idle",
  setActive: nothing,
  noteWalked: nothing,
  noteAnnotationSaved: nothing,
  toggle: nothing,
  noteHandoffOpened: nothing,
  noteHandoffAdded: nothing,
  resetHandoff: nothing,
};

export const TRACE_EXPLORER_SCOPE_ABSENT: TraceExplorerScopeState = {
  queryText: "",
  selectionMode: "explicit",
  selectedTraceIds: new Set<string>(),
  viewChip: {
    id: "view:traces:default:",
    kind: "filter",
    label: "Traces",
    ref: "data source: traces",
  },
  linkLensId: void 0,
};

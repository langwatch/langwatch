import {
  type ColumnSortRules,
  type ColumnSortState,
  nextColumnSort,
  sortRowsByColumn,
  useColumnSort,
} from "./columnSort";

/**
 * The Sessions table's columns, named against the shared column-sort shape in
 * `columnSort.ts`.
 *
 * The table opens on the session that moved most recently, because the reader
 * arrives asking what they were just doing and what it cost. Every column can
 * take over from there, and a third click hands the opening order back.
 *
 * Spec: specs/coding-agent/sessions-screen.feature.
 */

export type SessionsSortColumn =
  | "session"
  | "agent"
  | "lastUpdate"
  | "context"
  | "compactions"
  | "activeTime"
  | "cost"
  | "pullRequests";

export type SessionsSortState = ColumnSortState<SessionsSortColumn>;

export const DEFAULT_SESSIONS_SORT = {
  column: "lastUpdate",
  direction: "desc",
} as const satisfies SessionsSortState;

/** Everything a row has to carry for the table's order to be decidable. */
export interface SortableSessionRow {
  /** The title the agent generated, or null when there is none to show. */
  title: string | null;
  /** The branch the session ended on, which names an untitled row. */
  gitBranch: string;
  agent: string;
  /** When the session last moved: its last event, or its start. */
  lastUpdateAtMs: number;
  /** Every token the session consumed, the four counters summed. */
  totalTokens: number;
  compactions: number;
  /** Seconds the agent spent working. */
  activeTimeCliSec: number;
  /** Null when this reader may not price the project. */
  costUsd: number | null;
  /** Every pull request the session drove, by number ascending. */
  pullRequests: ReadonlyArray<{ number: number }>;
}

/**
 * When a session last moved. A session that never produced an event still
 * happened, so it reads by the moment it started rather than by nothing.
 */
export function sessionLastUpdateAtMs(row: {
  lastEventOccurredAtMs: number;
  startedAtMs: number;
}): number {
  return Math.max(row.lastEventOccurredAtMs, row.startedAtMs);
}

/** Every token a session consumed, live and cached alike. */
export function sessionTotalTokens(row: {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}): number {
  return (
    row.inputTokens +
    row.outputTokens +
    row.cacheReadTokens +
    row.cacheCreationTokens
  );
}

const SESSIONS_SORT_RULES: ColumnSortRules<
  SessionsSortColumn,
  SortableSessionRow
> = {
  defaultSort: DEFAULT_SESSIONS_SORT,
  // A measure leads with its largest value, a name leads with A.
  initialDirection: {
    session: "asc",
    agent: "asc",
    lastUpdate: "desc",
    context: "desc",
    compactions: "desc",
    activeTime: "desc",
    cost: "desc",
    pullRequests: "desc",
  },
  keyOf: {
    // An untitled session is still named on the row, by the branch it drove,
    // so it sorts by the same words the reader is looking at.
    session: (row) => (row.title ?? row.gitBranch).toLowerCase(),
    agent: (row) => row.agent.toLowerCase() || null,
    lastUpdate: (row) => row.lastUpdateAtMs,
    // The column reads peak context above the total, and sorts by the total:
    // peak says how heavy one call got, the total says what the session cost,
    // and the reader ordering this column is asking the second question.
    context: (row) => row.totalTokens,
    compactions: (row) => row.compactions,
    activeTime: (row) => row.activeTimeCliSec,
    cost: (row) => row.costUsd,
    // A session that drove several is ranked by its lowest pull request
    // number, so the column orders by where a session's work sits in the
    // repository's numbering rather than by when the session ran. A session
    // that drove none has nothing to rank.
    pullRequests: (row) =>
      row.pullRequests.length === 0
        ? null
        : Math.min(...row.pullRequests.map((each) => each.number)),
  },
  tieBreak: (left, right) => right.lastUpdateAtMs - left.lastUpdateAtMs,
};

/**
 * The next sort a click on `column` asks for. A column the table is not sorted
 * by starts in its own reading direction, a second click reverses it, and a
 * third gives the table back its opening order.
 */
export function nextSessionsSort({
  current,
  column,
}: {
  current: SessionsSortState;
  column: SessionsSortColumn;
}): SessionsSortState {
  return nextColumnSort({ current, column, rules: SESSIONS_SORT_RULES });
}

/**
 * The rows in the order the table draws them. Every column falls back to the
 * most recently updated session, so two rows a column cannot tell apart still
 * read in the order the page opened in.
 */
export function sortSessionRows<T extends SortableSessionRow>({
  rows,
  sort,
}: {
  rows: readonly T[];
  sort: SessionsSortState;
}): T[] {
  return sortRowsByColumn({ rows, sort, rules: SESSIONS_SORT_RULES });
}

export function useSessionsSort<T extends SortableSessionRow>({
  rows,
}: {
  rows: readonly T[];
}): {
  sorted: T[];
  sort: SessionsSortState;
  onSort: (column: SessionsSortColumn) => void;
} {
  return useColumnSort({ rows, rules: SESSIONS_SORT_RULES });
}

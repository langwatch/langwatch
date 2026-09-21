/**
 * The slice of the Explorer's state every transform reads and writes. The
 * parsed query, the debounced copies and the keyset cursors follow from these
 * fields, which is what lets one function run in the browser and on the server.
 */
export interface ExplorerState {
  queryText: string;
  timeRange: { from: number; to: number; label?: string; presetId?: string };
  activeLensId: string;
  sort: { columnId: string; direction: "asc" | "desc" };
  grouping: ExplorerGrouping;
  columnOrder: string[];
  page: number;
  pageSize: number;
  selection: { mode: "explicit" | "all-matching"; traceIds: Set<string> };
  expandedRows: Set<string>;
  evalRuns: Record<string, unknown>;
}

/** How the table groups its rows. Mirrors the lens store's own grouping ids. */
export type ExplorerGrouping = "flat" | "by-conversation" | "by-service" | "by-user" | "by-model";

/**
 * What a transform may know beyond the state, supplied by whoever runs it. All
 * optional because the away fallback has none, so a transform checks only what
 * it was given.
 */
export interface ExplorerTransformContext {
  /** The lenses the page holds, built-in and saved. */
  lenses?: readonly {
    id: string;
    filterText: string;
    sort: ExplorerState["sort"];
    grouping: ExplorerGrouping;
    columns: string[];
  }[];
  /** The count the last read answered for the state, when there was one. */
  totalHits?: number | null;
  /**
   * What the page's current table can sort by, and what it sorts by when a
   * sort does not survive a regrouping. The page reads both from its lens
   * capabilities; the away fallback has no table and supplies neither.
   */
  sortableColumnIds?: readonly string[];
  defaultSortFor?: (grouping: ExplorerGrouping) => ExplorerState["sort"] | undefined;
}

/**
 * Stable refusal codes. Callers map them onto their own presentation; the
 * message is for logs only.
 */
export const EXPLORER_TRANSFORM_ERROR_CODES = [
  /** The query does not parse, or the language refuses it. */
  "filter_invalid",
  /** The window ends at or before its start, or a bound is not a time. */
  "time_range_invalid",
  "preset_unknown",
  "lens_not_found",
  /** The grouping's table has no such sortable column. */
  "sort_column_unknown",
  "page_out_of_range",
  "page_size_invalid",
  "invalid_payload",
] as const;

export type ExplorerTransformErrorCode = (typeof EXPLORER_TRANSFORM_ERROR_CODES)[number];

/**
 * The one failure type a transform throws. Carries a stable `code` so a caller
 * acts on it without reading prose, plus optional `meta` naming what was
 * refused.
 */
export class ExplorerTransformError extends Error {
  readonly code: ExplorerTransformErrorCode;
  readonly meta?: Record<string, unknown>;

  constructor({
    code,
    message,
    meta,
  }: {
    code: ExplorerTransformErrorCode;
    message?: string;
    meta?: Record<string, unknown>;
  }) {
    super(message ?? code);
    this.name = "ExplorerTransformError";
    this.code = code;
    this.meta = meta;
  }
}

export const isExplorerTransformError = (error: unknown): error is ExplorerTransformError =>
  error instanceof ExplorerTransformError;

/**
 * A pure Explorer transform: state in, state out, plus an optional result the
 * caller reports back (the query applied, the window resolved).
 */
export type ExplorerTransform<Payload, Result = undefined> = (args: {
  state: ExplorerState;
  payload: Payload;
  context?: ExplorerTransformContext;
}) => { state: ExplorerState; result?: Result };

/**
 * A transform with its payload type erased, for the manifest. `payload: never`
 * is what makes every concrete transform assignable: parameters are
 * contravariant. The executor parses with the kind's schema before calling.
 */
export type AnyExplorerTransform = (args: {
  state: ExplorerState;
  payload: never;
  context?: ExplorerTransformContext;
}) => { state: ExplorerState; result?: unknown };

import type { ExplorerStore } from "../../stores/explorerStore";
import type { LensConfig } from "../../stores/viewSlice";

/**
 * The slice of the Explorer store every transform reads and writes: the page
 * state, and nothing derived from it.
 *
 * The parsed query, the debounced copies and the keyset cursors are left out
 * on purpose: they follow from these fields, and the store recomputes them
 * when a transformed state is committed (`../commitExplorerState.ts`). That is
 * what lets the same function run in the browser and on the server, where
 * there is no store at all.
 */
export type ExplorerState = Pick<
  ExplorerStore,
  | "queryText"
  | "timeRange"
  | "activeLensId"
  | "sort"
  | "grouping"
  | "columnOrder"
  | "page"
  | "pageSize"
  | "selection"
  | "expandedRows"
  | "evalRuns"
>;

/**
 * What a transform may know beyond the state, supplied by whoever runs it.
 *
 * Both are optional because the away fallback has neither: with no page open
 * there is no lens list to check an id against and no count to bound a page
 * by, so a transform checks only what it was given.
 */
export interface ExplorerTransformContext {
  /** The lenses the page holds, built-in and saved. */
  lenses?: ReadonlyArray<
    Pick<LensConfig, "id" | "filterText" | "sort" | "grouping" | "columns">
  >;
  /** The count the last read answered for the state, when there was one. */
  totalHits?: number | null;
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

export type ExplorerTransformErrorCode =
  (typeof EXPLORER_TRANSFORM_ERROR_CODES)[number];

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

export const isExplorerTransformError = (
  error: unknown,
): error is ExplorerTransformError => error instanceof ExplorerTransformError;

/**
 * A pure Explorer transform: state in, state out, plus an optional result the
 * caller reports back (the query applied, the window resolved).
 */
export type Transform<Payload, Result = undefined> = (args: {
  state: ExplorerState;
  payload: Payload;
  context?: ExplorerTransformContext;
}) => { state: ExplorerState; result?: Result };

/**
 * A transform with its payload type erased, for the manifest.
 *
 * `payload: never` is what makes every concrete `Transform<P, R>` assignable
 * here: function parameters are contravariant, and `never` is assignable to
 * every `P`. The executor parses the payload with the kind's schema before it
 * calls through, which is where the real type is checked.
 */
export type AnyExplorerTransform = (args: {
  state: ExplorerState;
  payload: never;
  context?: ExplorerTransformContext;
}) => { state: ExplorerState; result?: unknown };

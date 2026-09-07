/**
 * The message contract between the parent page and a sandboxed chart frame.
 *
 * Framework-free on purpose: the shim (a string of plain JS), the parent
 * bridge, and the playground UI all speak these shapes, and the eventual
 * production CustomGraph kind can reuse them unchanged.
 *
 * Transport: the parent posts exactly one `lw:init` through `postMessage`
 * with a transferred `MessagePort`; every other message travels over that
 * port in both directions.
 */

/** The page-level parameters the frame reads and is notified about. */
export interface ChartFrameParams {
  /** Epoch milliseconds — plain numbers so the payload is structured-clonable. */
  readonly timeWindow: { readonly start: number; readonly end: number };
  readonly granularitySeconds: number;
}

export type ChartFrameTheme = "light" | "dark";

/**
 * A bound parameter's value, as the frame may supply it to `LW.query`.
 * Matches `analytics.lwql.query`'s own `parameterValueSchema` minus `null` —
 * a value the frame chooses to pass is always one of these three JS types,
 * checked against the query's declared parameter types before anything
 * forwards to lwql (see `PlaygroundQuery.parameters` in
 * `~/server/analytics/playgroundWidgetDefinition`).
 */
export type ChartQueryParamValue = string | number | boolean;

/**
 * The reply payload, mirroring `LangWatchQLQueryResult`
 * (~/server/analytics/lwql/lwql.service.ts) structurally with clonable types.
 */
export interface ChartQueryResult {
  readonly columns: readonly { readonly name: string; readonly type: string }[];
  readonly rows: readonly Record<string, unknown>[];
  readonly statistics: Record<string, unknown>;
  readonly truncated: boolean;
  readonly diagnostics: readonly Record<string, unknown>[];
  readonly followsTimeWindow: boolean;
  readonly followsGranularity: boolean;
  readonly granularitySeconds?: number;
  readonly coarsenedFromSeconds?: number;
}

/**
 * What a rejected `LW.query` carries. Built by the parent through the error
 * registry (`explainAnyError`) — never a raw `error.message` (ADR-045).
 */
export interface ChartQueryError {
  readonly code: string;
  readonly title: string;
  readonly message: string;
}

// ---------------------------------------------------------------------------
// Parent → frame
// ---------------------------------------------------------------------------

export interface LwInitMessage {
  readonly type: "lw:init";
  readonly params: ChartFrameParams;
  readonly theme: ChartFrameTheme;
}

export interface LwQueryResultMessage {
  readonly type: "lw:query-result";
  readonly requestId: number;
  readonly result: ChartQueryResult;
}

export interface LwQueryErrorMessage {
  readonly type: "lw:query-error";
  readonly requestId: number;
  readonly error: ChartQueryError;
}

export interface LwParamsChangeMessage {
  readonly type: "lw:params-change";
  readonly params: ChartFrameParams;
}

export type ParentToFrameMessage =
  | LwInitMessage
  | LwQueryResultMessage
  | LwQueryErrorMessage
  | LwParamsChangeMessage;

// ---------------------------------------------------------------------------
// Frame → parent (over the transferred port)
// ---------------------------------------------------------------------------

export interface LwQueryMessage {
  readonly type: "lw:query";
  readonly requestId: number;
  /** Which of the widget's declared queries to run. SQL never travels from
   *  the frame — only the name and the bind values for its parameters. */
  readonly queryName: string;
  readonly params: Readonly<Record<string, ChartQueryParamValue>>;
}

export interface LwSetHeightMessage {
  readonly type: "lw:set-height";
  readonly px: number;
}

/**
 * Route keys `LW.navigate` may target. An allowlist, not a raw path: author
 * code is semi-trusted (it runs in the sandboxed frame but was written by
 * whoever has playground edit access), so a raw destination path would be an
 * open redirect. The host resolves each key to a real URL itself — see
 * `usePlaygroundChartNavigate`.
 */
export const NAVIGABLE_TARGETS = ["traces", "trace"] as const;
export type NavigableTarget = (typeof NAVIGABLE_TARGETS)[number];

export interface LwNavigateMessage {
  readonly type: "lw:navigate";
  readonly target: string;
  readonly params: Readonly<Record<string, unknown>>;
}

/** Where a forwarded log/error line originated inside the frame. */
export type ChartFrameLogSource =
  | "console"
  | "error"
  | "unhandledrejection"
  | "lw.error";

export interface LwLogMessage {
  readonly type: "lw:log";
  readonly level: "log" | "info" | "warn" | "error";
  readonly source: ChartFrameLogSource;
  /** Pre-stringified in the frame so anything (DOM nodes, cycles) survives. */
  readonly parts: readonly string[];
}

export interface LwErrorMessage {
  readonly type: "lw:error";
  readonly source: ChartFrameLogSource;
  readonly message: string;
}

export interface LwHeartbeatMessage {
  readonly type: "lw:heartbeat";
}

export type FrameToParentMessage =
  | LwQueryMessage
  | LwSetHeightMessage
  | LwNavigateMessage
  | LwLogMessage
  | LwErrorMessage
  | LwHeartbeatMessage;

// ---------------------------------------------------------------------------
// Shared limits
// ---------------------------------------------------------------------------

export const CHART_FRAME_MIN_HEIGHT_PX = 60;
export const CHART_FRAME_MAX_HEIGHT_PX = 640;
/**
 * Frame posts one every 2s; parent tears down after ~10s of silence (a few
 * consecutive missed beats, not a single miss) — tolerant of main-thread
 * jitter across ~25 live iframes and of browser timer throttling. The
 * watchdog additionally pauses while the tab is hidden (see frameBridge.ts),
 * since a backgrounded tab throttles both sides' timers and misses there are
 * meaningless.
 */
export const CHART_FRAME_HEARTBEAT_INTERVAL_MS = 2000;
export const CHART_FRAME_HEARTBEAT_TIMEOUT_MS = 10000;

/**
 * The one structural mapping from the server's result to the wire payload.
 * Picks fields explicitly so nothing non-clonable or unexpected rides along.
 */
export function toChartQueryResult(result: {
  readonly columns: readonly { readonly name: string; readonly type: string }[];
  readonly rows: readonly Record<string, unknown>[];
  readonly statistics: unknown;
  readonly truncated: boolean;
  readonly diagnostics: readonly unknown[];
  readonly followsTimeWindow: boolean;
  readonly followsGranularity: boolean;
  readonly granularitySeconds?: number;
  readonly coarsenedFromSeconds?: number;
}): ChartQueryResult {
  return {
    columns: result.columns.map((column) => ({
      name: column.name,
      type: column.type,
    })),
    rows: result.rows,
    statistics: (result.statistics ?? {}) as Record<string, unknown>,
    truncated: result.truncated,
    diagnostics: result.diagnostics as readonly Record<string, unknown>[],
    followsTimeWindow: result.followsTimeWindow,
    followsGranularity: result.followsGranularity,
    ...(result.granularitySeconds !== undefined
      ? { granularitySeconds: result.granularitySeconds }
      : {}),
    ...(result.coarsenedFromSeconds !== undefined
      ? { coarsenedFromSeconds: result.coarsenedFromSeconds }
      : {}),
  };
}

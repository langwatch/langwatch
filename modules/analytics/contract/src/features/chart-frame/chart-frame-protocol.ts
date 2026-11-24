/**
 * Message contract between the parent page and a sandboxed chart frame -- framework-free so the
 * shim, parent bridge, playground UI and future production CustomGraph all speak it. Transport:
 * one `lw:init` over `postMessage` with a transferred `MessagePort`; the rest travels the port.
 */

import type {
  LangWatchQLDiagnostic,
  LangWatchQLStatistics,
  QueryCompleteness,
} from "../lwql/analytics.lwql.ts";

export type ChartFrameTheme = "light" | "dark";

/**
 * The route the sandboxed chart-frame document is served from, once the api
 * serves it with its own permissive CSP. Named here — framework-free — so the
 * component, the bridge and the server share one spelling.
 */
export const CHART_FRAME_PATH = "/sandbox/chart-frame";

/**
 * Host-supplied, read-only dashboard state -- never something author code can set. Delivered on
 * `lw:init` and again on every `lw:dashboard-context-change`. The four id/name fields are
 * optional: the playground preview has no persisted dashboard record to supply them from.
 */
export interface ChartFrameDashboardContext {
  /** Epoch milliseconds — plain numbers so the payload is structured-clonable. */
  readonly timeWindow: { readonly start: number; readonly end: number };
  readonly granularitySeconds: number;
  /** IANA zone name, e.g. "America/Sao_Paulo". */
  readonly timezone?: string;
  readonly theme: ChartFrameTheme;
  /** Active design-system colours resolved by the host for the opaque frame. */
  readonly colors?: Readonly<Record<string, string>>;
  readonly widgetId?: string;
  readonly dashboardId?: string;
  readonly projectId?: string;
  readonly widgetName?: string;
  /**
   * Epoch ms of the dashboard's last scheduled refresh, absent before the
   * first. Changes on its own schedule while nothing else does, which is
   * what makes a refresh tick a distinct context change for `useChartQuery`.
   */
  readonly refreshedAt?: number;
  /** Set when the host takes `LW.askLangy`: only then may a chart make its marks clickable. */
  readonly canAskLangy?: boolean;
}

/**
 * A snapshot of the widget's author-declared parameters at their current (default) values --
 * there is no dashboard-side UI to override them yet. Delivered on `lw:init` only.
 */
export type ChartFrameParamsSnapshot = Readonly<Record<string, ChartQueryParamValue>>;

/**
 * A bound parameter's value the frame may supply to `LW.query` -- matches
 * `analytics.lwql.query`'s `parameterValueSchema` minus `null`. Checked against the query's
 * declared parameter types before anything forwards to lwql.
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
  readonly diagnostics: readonly Record<string, unknown>[];
  readonly followsTimeWindow: boolean;
  readonly followsGranularity: boolean;
  readonly granularitySeconds?: number;
  readonly coarsenedFromSeconds?: number;
  /** What the rows are missing; absent when the server could not tell. */
  readonly completeness?: QueryCompleteness;
}

/**
 * What a rejected `LW.query` carries. Built by the parent through the error
 * registry (`explainAnyError`) — never a raw `error.message` (ADR-045).
 */
export interface ChartQueryError {
  readonly code: string;
  readonly title: string;
  readonly message: string;
  /** Set when the same request is expected to succeed shortly; the hook retries it. */
  readonly retryable?: boolean;
  /**
   * Set when the query was refused only because the reader may not see what it reads: the gates
   * they lack, such as "cost:view". The host then shows "no access", not a failure.
   */
  readonly missingGates?: readonly string[];
}

// ---------------------------------------------------------------------------
// Parent → frame
// ---------------------------------------------------------------------------

export interface LwInitMessage {
  readonly type: "lw:init";
  readonly dashboardContext: ChartFrameDashboardContext;
  /** Author-declared parameters and their current (default) values. */
  readonly params: ChartFrameParamsSnapshot;
  /**
   * The widget's React/TSX source. Delivered here rather than baked into the
   * frame document: the document is shared by every widget, so each frame
   * receives its own author code over this message.
   */
  readonly source: string;
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

export interface LwDashboardContextChangeMessage {
  readonly type: "lw:dashboard-context-change";
  readonly dashboardContext: ChartFrameDashboardContext;
}

export type ParentToFrameMessage =
  | LwInitMessage
  | LwQueryResultMessage
  | LwQueryErrorMessage
  | LwDashboardContextChangeMessage;

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
 * Route keys `LW.navigate` may target -- an allowlist, not a raw path, since author code is
 * semi-trusted and a raw destination would be an open redirect.
 * @see useDashboardWidgetChartNavigate
 */
export const NAVIGABLE_TARGETS = [
  "traces",
  "trace",
  "scenarios",
  "onlineEvaluations",
  "annotations",
  "gatewayVirtualKeys",
  "codingSessions",
] as const;
export type NavigableTarget = (typeof NAVIGABLE_TARGETS)[number];

export interface LwNavigateMessage {
  readonly type: "lw:navigate";
  readonly target: string;
  readonly params: Readonly<Record<string, unknown>>;
}

/** What a clicked bar, point or legend entry asks Langy about: a category or series. */
export interface ChartAskSubject {
  readonly label: string;
  /** The bucket the click landed on, as the chart labels it. */
  readonly at?: string;
}

/** The longest label or bucket the host keeps from a frame's ask; the rest is cut. */
export const CHART_ASK_TEXT_MAX_LENGTH = 200;

/**
 * `LW.askLangy(subject)`: the host drafts a Langy prompt about it. Author code is semi-trusted,
 * so the host reads the subject through `readChartAsk` and drops anything else.
 */
export interface LwAskLangyMessage {
  readonly type: "lw:ask-langy";
  readonly subject: unknown;
}

/** A frame's ask as the host reads it: a subject, or nameless when it names no label. */
export type ChartAskReading =
  | { readonly kind: "subject"; readonly subject: ChartAskSubject }
  | { readonly kind: "nameless" };

const NAMELESS_ASK: ChartAskReading = { kind: "nameless" };

/** Reads what a frame's ask names, cut to length. */
export function readChartAsk(raw: unknown): ChartAskReading {
  if (typeof raw !== "object" || raw === null) return NAMELESS_ASK;
  const text = (value: unknown) =>
    typeof value === "string" || typeof value === "number"
      ? String(value).trim().slice(0, CHART_ASK_TEXT_MAX_LENGTH)
      : "";
  const { label, at } = raw as { label?: unknown; at?: unknown };
  const named = text(label);
  if (named.length === 0) return NAMELESS_ASK;
  const bucket = text(at);
  const subject = bucket.length > 0 ? { label: named, at: bucket } : { label: named };
  return { kind: "subject", subject };
}

/** Where a forwarded log/error line originated inside the frame. */
export type ChartFrameLogSource = "console" | "error" | "unhandledrejection" | "lw.error";

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
  /** The widget's code has mounted and waits on nothing: no query open, no retry pending. */
  readonly idle: boolean;
}

export type FrameToParentMessage =
  | LwQueryMessage
  | LwSetHeightMessage
  | LwNavigateMessage
  | LwAskLangyMessage
  | LwLogMessage
  | LwErrorMessage
  | LwHeartbeatMessage;

// ---------------------------------------------------------------------------
// Shared limits
// ---------------------------------------------------------------------------

export const CHART_FRAME_MIN_HEIGHT_PX = 60;
export const CHART_FRAME_MAX_HEIGHT_PX = 640;
/**
 * Frame posts one every 2s; parent tears down after ~10s of silence (a few missed beats, not
 * one) -- tolerant of jitter/throttling, and paused while the tab is hidden.
 * @see frameBridge.ts
 */
export const CHART_FRAME_HEARTBEAT_INTERVAL_MS = 2000;
export const CHART_FRAME_HEARTBEAT_TIMEOUT_MS = 10000;
/** How often the frame retries a retryable query failure before it counts; the host reads it. */
export const CHART_QUERY_MAX_RETRIES = 3;

/**
 * The one structural mapping from the server's result to the wire payload.
 * Picks fields explicitly so nothing non-clonable or unexpected rides along.
 */
export function toChartQueryResult(result: {
  readonly columns: readonly { readonly name: string; readonly type: string }[];
  readonly rows: readonly Record<string, unknown>[];
  readonly statistics: LangWatchQLStatistics;
  readonly diagnostics: readonly LangWatchQLDiagnostic[];
  readonly followsTimeWindow: boolean;
  readonly followsGranularity: boolean;
  readonly granularitySeconds?: number;
  readonly coarsenedFromSeconds?: number;
  readonly completeness?: QueryCompleteness;
}): ChartQueryResult {
  return {
    columns: result.columns.map((column) => ({
      name: column.name,
      type: column.type,
    })),
    rows: result.rows,
    statistics: { ...result.statistics },
    diagnostics: result.diagnostics.map((diagnostic) => ({ ...diagnostic })),
    followsTimeWindow: result.followsTimeWindow,
    followsGranularity: result.followsGranularity,
    ...(result.granularitySeconds !== undefined
      ? { granularitySeconds: result.granularitySeconds }
      : {}),
    ...(result.coarsenedFromSeconds !== undefined
      ? { coarsenedFromSeconds: result.coarsenedFromSeconds }
      : {}),
    ...(result.completeness !== undefined
      ? { completeness: cloneCompleteness(result.completeness) }
      : {}),
  };
}

/** A plain copy, so only the contract's fields cross the port. */
function cloneCompleteness(completeness: QueryCompleteness): QueryCompleteness {
  const { state, unit, total, fields, buckets, unpriced } = completeness;
  return {
    state,
    unit,
    total,
    fields: fields.map(({ field, label, present }) => ({ field, label, present })),
    ...(buckets ? { buckets: buckets.map(({ start, n }) => ({ start, n })) } : {}),
    ...(unpriced ? { unpriced: { count: unpriced.count, models: [...unpriced.models] } } : {}),
  };
}

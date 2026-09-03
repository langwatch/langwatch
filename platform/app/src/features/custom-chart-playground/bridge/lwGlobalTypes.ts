/**
 * Monaco IntelliSense for the `LW` global authors use inside the
 * dashboard-widget code editor. Registered as an "extra lib" (see
 * `DashboardWidgetCodeEditor.tsx`'s `configureTypeScriptDefaults`) so the
 * TypeScript worker offers completions and hover docs for `LW.*` even though
 * `noSemanticValidation` is on and this file never actually runs — the real
 * `LW` object is built at runtime by `bridge/shimSource.ts`.
 *
 * Keep this in sync with `bridge/shimSource.ts`'s `LW` object (search that
 * file for "keep in sync with bridge/lwGlobalTypes.ts") and with the wire
 * shapes in `bridge/bridgeProtocol.ts`, which this file mirrors structurally.
 */

export const LW_GLOBAL_DTS = `
/** Epoch-millisecond window the dashboard's time picker currently covers. */
interface LwTimeWindow {
  readonly start: number;
  readonly end: number;
}

/** The page-level parameters \`LW.params\` holds and \`LW.onParamsChange\` reports. */
interface LwParams {
  readonly timeWindow: LwTimeWindow;
  readonly granularitySeconds: number;
}

type LwTheme = "light" | "dark";

/** A bound value for one of a query's declared parameters. */
type LwQueryParamValue = string | number | boolean;

interface LwQueryColumn {
  readonly name: string;
  readonly type: string;
}

/** What a resolved \`LW.query(...)\` (and \`useChartQuery\`'s \`data\`) carries. */
interface LwQueryResult {
  readonly columns: readonly LwQueryColumn[];
  readonly rows: readonly Record<string, unknown>[];
  readonly statistics: Record<string, unknown>;
  readonly truncated: boolean;
  readonly diagnostics: readonly Record<string, unknown>[];
  readonly followsTimeWindow: boolean;
  readonly followsGranularity: boolean;
  readonly granularitySeconds?: number;
  readonly coarsenedFromSeconds?: number;
}

/** What a rejected \`LW.query(...)\` throws as (and \`useChartQuery\`'s \`error\`). */
interface LwQueryError extends Error {
  readonly code?: string;
  readonly title?: string;
}

/** The four \`console\`/error origins the frame forwards to the parent for logging. */
type LwLogSource = "console" | "error" | "unhandledrejection" | "lw.error";

/** Route keys \`LW.navigate\` accepts — an allowlist the host resolves to a real URL. */
type LwNavigableTarget = "traces" | "trace";

/** Return shape of \`LW.useChartQuery\`, matching TanStack Query's \`useQuery\` naming. */
interface LwChartQueryState {
  /** \`result.rows\` once loaded, else \`null\`. */
  readonly data: readonly Record<string, unknown>[] | null;
  /** True only on the first load (no data yet), not on background refetches. */
  readonly isLoading: boolean;
  /** True for the initial load AND every refetch (params change, page time window change, manual \`refetch()\`). */
  readonly isFetching: boolean;
  readonly isError: boolean;
  readonly error: LwQueryError | null;
  readonly status: "pending" | "success" | "error";
  /** Re-runs the query on demand, e.g. from a "Retry" button. */
  readonly refetch: () => void;
}

/** The API a dashboard widget's code runs against, injected as \`window.LW\`. */
interface LwApi {
  /**
   * The dashboard's current page-level parameters (time window, granularity).
   * Set synchronously before author code's first line runs; updates in place
   * on \`LW.onParamsChange\` — read it fresh each time rather than caching it.
   */
  readonly params: LwParams;

  /** The dashboard's current color theme, fixed for the frame's lifetime. */
  readonly theme: LwTheme;

  /**
   * Runs one of the widget's declared queries by name, forwarding the given
   * bind values. SQL never runs in the frame — only \`queryName\` and \`params\`
   * cross the bridge. Reject with an \`LwQueryError\`.
   *
   * Prefer \`useChartQuery\` in React widget code — it wraps this promise with
   * loading/error state and automatic refetch on page-level param changes.
   *
   * Reserved parameter names (\`period_start\`, \`period_end\`,
   * \`period_granularity_seconds\`) are bound automatically from \`LW.params\`
   * and should not be passed here.
   */
  query: (
    queryName: string,
    params?: Readonly<Record<string, LwQueryParamValue>>,
  ) => Promise<LwQueryResult>;

  /**
   * The recommended way to fetch: wraps \`LW.query\` in a React hook with the
   * same shape as TanStack Query's \`useQuery\` (data, isLoading, isFetching,
   * isError, error, status, refetch). Refetches automatically whenever the
   * page's time window or granularity changes, via \`LW.onParamsChange\` —
   * a widget using this hook stays live without touching that API directly.
   */
  useChartQuery: (
    queryName: string,
    params?: Readonly<Record<string, LwQueryParamValue>>,
  ) => LwChartQueryState;

  /**
   * Requests the frame's iframe be resized to \`px\` (clamped to the host's
   * min/max). Call after layout settles, e.g. once a chart's content is known.
   */
  setHeight: (px: number) => void;

  /**
   * Subscribes to page-level parameter changes (time window, granularity).
   * Returns an unsubscribe function — call it on cleanup (e.g. a React
   * effect's return) to avoid leaking a listener per mount.
   */
  onParamsChange: (callback: (params: LwParams) => void) => () => void;

  /** Reports an error to the parent's console/telemetry without throwing. */
  error: (err: unknown) => void;

  /**
   * Navigates the host to an allowlisted target (e.g. a trace list or a
   * single trace), passing along \`params\` the host uses to build the URL.
   * Fire-and-forget — does not return a value.
   */
  navigate: (
    target: LwNavigableTarget,
    params?: Readonly<Record<string, unknown>>,
  ) => void;
}

declare const LW: LwApi;
`;

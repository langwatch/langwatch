/**
 * Monaco IntelliSense for the widget editor's `LW` global; never runs. The real object
 * is the contract's `chart-frame-shim-source.ts`, and a unit test fails when it adds
 * a member not declared here.
 */

export const LW_GLOBAL_DTS = `
/** Epoch-millisecond window the dashboard's time picker currently covers. */
interface LwTimeWindow {
  readonly start: number;
  readonly end: number;
}

type LwTheme = "light" | "dark";

/**
 * Host-supplied, read-only snapshot of the dashboard's own state —
 * everything a widget did NOT author itself. Set synchronously before
 * author code's first line runs; updates in place on
 * \`LW.onDashboardContextChange\` (or live via \`LW.useDashboardContext\`) —
 * read it fresh each time rather than caching it.
 *
 * \`widgetId\`/\`dashboardId\`/\`projectId\`/\`widgetName\` are optional: not
 * every host (e.g. the playground preview) can supply them.
 */
interface LwDashboardContext {
  readonly timeWindow: LwTimeWindow;
  readonly granularitySeconds: number;
  /** IANA zone name, e.g. "America/Sao_Paulo". */
  readonly timezone?: string;
  readonly theme: LwTheme;
  readonly widgetId?: string;
  readonly dashboardId?: string;
  readonly projectId?: string;
  readonly widgetName?: string;
  /**
   * When the dashboard last refreshed on its schedule (epoch ms), absent
   * before the first refresh. Every scheduled refresh changes it, so a
   * widget on \`useChartQuery\` re-runs its queries without doing anything.
   */
  readonly refreshedAt?: number;
}

/** A bound value for one of a query's declared parameters. */
type LwQueryParamValue = string | number | boolean;

/**
 * The widget's author-declared parameters and their current values (today,
 * always their declared defaults — there is no dashboard-side UI to
 * override them yet).
 */
type LwParams = Readonly<Record<string, LwQueryParamValue>>;

interface LwQueryColumn {
  readonly name: string;
  readonly type: string;
}

/**
 * Row shape per declared query name. Empty here; each widget's editor merges
 * the columns of the query's last run into it (see the generated row types).
 */
interface LwQueryRowMap {}

/** The row a query named \`N\` yields: its last-run columns, else an unknown record. */
type LwRow<N extends string> = N extends keyof LwQueryRowMap
  ? LwQueryRowMap[N]
  : Record<string, unknown>;

/** What a resolved \`LW.query(...)\` (and \`useChartQuery\`'s \`data\`) carries. */
interface LwQueryResult<Row = Record<string, unknown>> {
  readonly columns: readonly LwQueryColumn[];
  readonly rows: readonly Row[];
  readonly statistics: Record<string, unknown>;
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
type LwNavigableTarget =
  | "traces"
  | "trace"
  | "scenarios"
  | "onlineEvaluations"
  | "annotations"
  | "gatewayVirtualKeys"
  | "codingSessions";

/** Return shape of \`LW.useChartQuery\`, matching TanStack Query's \`useQuery\` naming. */
interface LwChartQueryState<Row = Record<string, unknown>> {
  /** \`result.rows\` once loaded, else \`null\`. */
  readonly data: readonly Row[] | null;
  /** True only on the first load (no data yet), not on background refetches. */
  readonly isLoading: boolean;
  /** True for the initial load AND every refetch (dashboard context change, manual \`refetch()\`). */
  readonly isFetching: boolean;
  readonly isError: boolean;
  readonly error: LwQueryError | null;
  readonly status: "pending" | "success" | "error";
  /** Re-runs the query on demand, e.g. from a "Retry" button. */
  readonly refetch: () => void;
}

/**
 * The API a dashboard widget's code runs against, injected as \`window.LW\`.
 *
 * Split in two by who supplies the value: \`dashboardContext\` is host-owned
 * (time window, granularity, theme, ids) and changes when the dashboard
 * itself changes; \`params\` is the widget's own author-declared parameters,
 * unrelated to the dashboard's state.
 */
interface LwApi {
  /** The dashboard's current context. See {@link LwDashboardContext}. */
  readonly dashboardContext: LwDashboardContext;

  /** The widget's current author-declared parameter values. */
  readonly params: LwParams;

  /** The dashboard's current color theme, fixed for the frame's lifetime. */
  readonly theme: LwTheme;

  /**
   * Runs one of the widget's declared queries by name, forwarding the given
   * bind values. SQL never runs in the frame — only \`queryName\` and \`params\`
   * cross the bridge. Reject with an \`LwQueryError\`.
   *
   * Prefer \`useChartQuery\` in React widget code — it wraps this promise with
   * loading/error state and automatic refetch on dashboard context changes.
   *
   * Reserved parameter names (\`dashboard_context_period_start\`,
   * \`dashboard_context_period_end\`, \`dashboard_context_granularity_seconds\`)
   * are bound automatically from \`LW.dashboardContext\` and should not be
   * passed here.
   */
  query: <N extends string>(
    queryName: N,
    params?: Readonly<Record<string, LwQueryParamValue>>,
  ) => Promise<LwQueryResult<LwRow<N>>>;

  /**
   * The recommended way to fetch: wraps \`LW.query\` in a React hook with the
   * same shape as TanStack Query's \`useQuery\` (data, isLoading, isFetching,
   * isError, error, status, refetch). Refetches automatically whenever the
   * dashboard context (time window, granularity) changes, via
   * \`LW.onDashboardContextChange\` — a widget using this hook stays live
   * without touching that API directly.
   */
  useChartQuery: <N extends string>(
    queryName: N,
    params?: Readonly<Record<string, LwQueryParamValue>>,
  ) => LwChartQueryState<LwRow<N>>;

  /**
   * Requests the frame's iframe be resized to \`px\` (clamped to the host's
   * min/max). Call after layout settles, e.g. once a chart's content is known.
   */
  setHeight: (px: number) => void;

  /**
   * Subscribes to dashboard context changes (time window, granularity).
   * Returns an unsubscribe function — call it on cleanup (e.g. a React
   * effect's return) to avoid leaking a listener per mount. Prefer
   * \`useDashboardContext\` in React widget code.
   */
  onDashboardContextChange: (
    callback: (dashboardContext: LwDashboardContext) => void,
  ) => () => void;

  /**
   * React hook returning the live \`LW.dashboardContext\`, re-rendering
   * whenever the host pushes an update.
   */
  useDashboardContext: () => LwDashboardContext;

  /**
   * React hook returning \`LW.params\` — the widget's author-declared parameter
   * values. A snapshot fixed for the frame's lifetime (there is no params-change
   * message), so it does not re-render on change.
   */
  useParams: () => LwParams;

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

interface Window {
  readonly LW: LwApi;
}
`;

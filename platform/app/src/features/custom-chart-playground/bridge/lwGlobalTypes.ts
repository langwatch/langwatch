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
  query: (
    queryName: string,
    params?: Readonly<Record<string, LwQueryParamValue>>,
  ) => Promise<LwQueryResult>;

  /**
   * The recommended way to fetch: wraps \`LW.query\` in a React hook with the
   * same shape as TanStack Query's \`useQuery\` (data, isLoading, isFetching,
   * isError, error, status, refetch). Refetches automatically whenever the
   * dashboard context (time window, granularity) changes, via
   * \`LW.onDashboardContextChange\` — a widget using this hook stays live
   * without touching that API directly.
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
   * React hook returning the live \`LW.params\` — the widget's author-declared
   * parameter values, re-rendering on change.
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
`;

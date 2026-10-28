/**
 * The LangWatchQL views a board's queries are allowed to name. Guards the
 * question picker's prompts against a typo'd or invented view.
 */
export const BOARD_LWQL_VIEWS = [
  "annotations",
  "coding_sessions",
  "evaluation_metrics",
  "gateway_request_spend",
  "model_usage_by_minute",
  "simulations",
  "spans",
  "topics",
  "trace_metrics",
  "trace_metrics_by_minute",
  "traces",
] as const;

/** Per-minute rollups: no Origin and no TraceId, so a board's origin scoping never reaches them. */
export const BOARD_ROLLUP_VIEWS: readonly string[] = [
  "model_usage_by_minute",
  "trace_metrics_by_minute",
];

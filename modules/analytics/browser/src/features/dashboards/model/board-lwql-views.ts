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

/**
 * Views with neither an `Origin` nor a `TraceId` column, which the server's
 * `buildOriginPredicates` (langwatch-ql-query-scope.rules.ts) never scopes. Mirror it by hand.
 */
export const BOARD_UNSCOPED_VIEWS: readonly string[] = [
  "coding_sessions",
  "evaluation_metrics_by_minute",
  "model_usage_by_minute",
  "simulations",
  "topics",
  "trace_metrics_by_minute",
];

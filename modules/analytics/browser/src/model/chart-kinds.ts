/**
 * The `CustomGraph.kind` values, as the browser reads them. Two features
 * share the stored-chart table (the chart builder and the LangWatchQL
 * workbench), so `kind` is what keeps a report grid from drawing the wrong editor.
 */

/** The kind every chart-builder row carries, and the column's default. */
export const BUILDER_CHART_KIND = "builder";

/** The kind a saved LangWatchQL workbench chart carries. */
export const WORKBENCH_SQL_CHART_KIND = "workbench_sql";

/**
 * The kind a persisted dashboard widget carries. Its `graph` column holds
 * `{ srcdocHtml, sql }`: the author HTML rendered in a sandboxed frame and
 * the LangWatchQL statement the parent executes on the frame's behalf.
 */
export const DASHBOARD_SRCDOC_CHART_KIND = "dashboard_srcdoc";

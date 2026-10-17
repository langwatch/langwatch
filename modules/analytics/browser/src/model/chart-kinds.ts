/**
 * The `CustomGraph.kind` values, as the browser reads them. Two features
 * share the stored-chart table (the chart builder and the LangWatchQL
 * workbench), so `kind` is what keeps a report grid from drawing the wrong editor.
 */

/** The kind every chart-builder row carries, and the column's default. */
export const BUILDER_CHART_KIND = "builder";

/** The kind a saved LangWatchQL workbench chart carries. */
export const WORKBENCH_SQL_CHART_KIND = "workbench_sql";

/**
 * CustomGraph.kind discriminates between chart-builder and LangWatchQL
 * workbench charts—defined here so both features can filter by the value
 * they own.
 */

/** Chart-builder discriminator; also the column default. */
export const BUILDER_CHART_KIND = "builder";

/** The kind a saved LangWatchQL workbench chart carries. */
export const WORKBENCH_SQL_CHART_KIND = "workbench_sql";

/** Dashboard widget with sandboxed srcdocHtml and LangWatchQL statement. */
export const DASHBOARD_SRCDOC_CHART_KIND = "dashboard_srcdoc";

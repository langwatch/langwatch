/** The organization's Dashboards area: its library, and the board pages under it (ADR-002). */
export const ORGANIZATION_DASHBOARDS_PATH = "/dashboards";

/** The library's query key that opens its create dialog; the library drops it once open. */
export const NEW_DASHBOARD_QUERY_KEY = "new";

/** The library with its create dialog open, where Quick Search's "Create a dashboard" leads. */
export const NEW_DASHBOARD_PATH = `${ORGANIZATION_DASHBOARDS_PATH}?${NEW_DASHBOARD_QUERY_KEY}=1`;

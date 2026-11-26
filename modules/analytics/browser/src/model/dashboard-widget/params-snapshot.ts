import { LWQL_TIME_ZONE_PARAMETER } from "@langwatch/analytics-contract";
import type { ChartFrameParamsSnapshot } from "@langwatch/analytics-contract/chart-frame-protocol";
import type { DashboardWidgetQuery } from "@langwatch/analytics-contract/dashboard-widget-definition";

/** `{dashboard_context_timezone:<type>}`, the placeholder the server binds the reader's zone to. */
const TIME_ZONE_DECLARATION = new RegExp(`\\{\\s*${LWQL_TIME_ZONE_PARAMETER}\\s*:`);

/** Whether any query declares the reader's zone, so its buckets start on the reader's clock. */
export function declaresTimeZone(queries: readonly Pick<DashboardWidgetQuery, "sql">[]): boolean {
  return queries.some((query) => TIME_ZONE_DECLARATION.test(query.sql));
}

/**
 * Every declared parameter's default, deduped by name across a widget's
 * queries — what `LW.params` holds until a dashboard-side override exists.
 */
export function declaredParamDefaults(
  queries: readonly Pick<DashboardWidgetQuery, "parameters">[],
): ChartFrameParamsSnapshot {
  const defaults: Record<string, string | number | boolean> = {};
  for (const query of queries) {
    for (const parameter of query.parameters ?? []) {
      if (parameter.default !== undefined) {
        defaults[parameter.name] = parameter.default;
      }
    }
  }
  return defaults;
}

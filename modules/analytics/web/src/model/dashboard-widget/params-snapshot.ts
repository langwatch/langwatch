import type { DashboardWidgetQuery } from "../dashboard-widget-definition.ts";

import type { ChartFrameParamsSnapshot } from "./bridge-protocol";

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

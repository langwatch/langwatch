/**
 * What a widget's LangWatchQL runs say they are for on the server's log line: the board, the
 * widget and the catalogue widget it was built from. Never a product event. Pure.
 * @see modules/dashboard/specs/dashboards-telemetry.feature
 */

import type { LangWatchQLRunTelemetryRequest } from "@langwatch/analytics-contract";
import type { dashboardWidgetDefinitionSchema } from "@langwatch/analytics-contract/dashboard-widget-definition";

/** A widget definition as the frame parsed it, valid or not. */
export type ParsedDefinition = ReturnType<typeof dashboardWidgetDefinitionSchema.safeParse>;

/** The id a From LangWatch board's runs are logged under: it has no stored board of its own. */
export function curatedBoardTelemetryId(templateId: string): string {
  return `curated/${templateId}`;
}

/** A placed widget's own ids, with the catalogue widget it was built from where it says. */
export function placedWidgetTelemetry({
  dashboardId,
  widgetId,
  parsed,
}: {
  dashboardId: string | undefined;
  widgetId: string;
  parsed: ParsedDefinition;
}): LangWatchQLRunTelemetryRequest | undefined {
  if (dashboardId === void 0) return void 0;
  const source = parsed.success ? parsed.data.source : void 0;
  return {
    dashboardId,
    widgetId,
    ...(source?.kind === "catalogue" ? { templateId: source.catalogueId } : {}),
  };
}

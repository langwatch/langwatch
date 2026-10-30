/**
 * The product events Dashboards sends, built here so every call site names them alike. Each is
 * `dashboards.<action>.<name>` once the host composes it; attributes carry no raw id and no SQL.
 * Pure.
 * @see modules/dashboard/specs/dashboards-telemetry.feature
 */

import type { DashboardWidgetQuery } from "@langwatch/analytics-contract/dashboard-widget-definition";
import type { UiAnalyticsEvent } from "@langwatch/browser-host/analytics";
import { LANGY_TRACE_ORIGIN } from "@langwatch/trace-contract";

/** The boundary every Dashboards product event is sent under. */
export const DASHBOARDS_BOUNDARY = "dashboards";

/** The id a From LangWatch board's runs are logged under: it has no stored board of its own. */
export function curatedBoardTelemetryId(templateId: string): string {
  return `curated/${templateId}`;
}

/** A board the member made and can change, or a From LangWatch board read live. */
export type DashboardKind = "stored" | "curated";

/** How a board was made. */
export type DashboardCreatedFrom = "blank" | "template" | "duplicate" | "duplicate_curated";

/** How a widget landed on a board. */
export type WidgetAddedFrom = "catalogue" | "editor" | "duplicate";

function dashboardsEvent(
  name: string,
  action: string,
  attributes: Readonly<Record<string, unknown>> = {},
): UiAnalyticsEvent {
  return { boundary: DASHBOARDS_BOUNDARY, name, action, attributes };
}

/** A board opened, once its widgets are known: "dashboards.viewed.dashboard". */
export function dashboardViewed({
  dashboardKind,
  widgetCount,
  templateId,
}: {
  dashboardKind: DashboardKind;
  widgetCount: number;
  templateId?: string;
}): UiAnalyticsEvent {
  return dashboardsEvent("dashboard", "viewed", {
    dashboardKind,
    widgetCount,
    ...(templateId === void 0 ? {} : { templateId }),
  });
}

/** A board made, and how: "dashboards.created.dashboard". */
export function dashboardCreated({
  createdFrom,
  templateId,
}: {
  createdFrom: DashboardCreatedFrom;
  templateId?: string;
}): UiAnalyticsEvent {
  return dashboardsEvent("dashboard", "created", {
    createdFrom,
    ...(templateId === void 0 ? {} : { templateId }),
  });
}

/** A board the server agreed to delete: "dashboards.deleted.dashboard". */
export function dashboardDeleted(): UiAnalyticsEvent {
  return dashboardsEvent("dashboard", "deleted");
}

/** A board or template starred or unstarred: "dashboards.favourited.dashboard". */
export function dashboardFavourited({ starred }: { starred: boolean }): UiAnalyticsEvent {
  return dashboardsEvent("dashboard", "favourited", { starred });
}

/** Widgets that landed on a board, and from where: "dashboards.added.widget". */
export function widgetAdded({
  addedFrom,
  widgetCount = 1,
}: {
  addedFrom: WidgetAddedFrom;
  widgetCount?: number;
}): UiAnalyticsEvent {
  return dashboardsEvent("widget", "added", { addedFrom, widgetCount });
}

/** A widget's edit saved: "dashboards.edited.widget". */
export function widgetEdited(): UiAnalyticsEvent {
  return dashboardsEvent("widget", "edited");
}

/** A widget the server agreed to delete: "dashboards.deleted.widget". */
export function widgetDeleted(): UiAnalyticsEvent {
  return dashboardsEvent("widget", "deleted");
}

/** Whether any of a widget's queries counts Langy's own traces; a query storing none does not. */
function countsLangyTraces(queries: readonly Pick<DashboardWidgetQuery, "sources">[]): boolean {
  return queries.some((query) => query.sources?.includes(LANGY_TRACE_ORIGIN) === true);
}

/**
 * The toggle a save makes, when it adds Langy's traces to a widget or takes them away; none when
 * the save leaves that as it was.
 */
export function langyTracesToggled({
  before,
  after,
}: {
  before: readonly Pick<DashboardWidgetQuery, "sources">[];
  after: readonly Pick<DashboardWidgetQuery, "sources">[];
}): UiAnalyticsEvent | undefined {
  const included = countsLangyTraces(after);
  if (included === countsLangyTraces(before)) return void 0;
  return dashboardsEvent("langy_traces", "toggled", { included });
}

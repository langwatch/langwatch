/**
 * The product events Dashboards sends, built here so every call site names them alike. Each is
 * `dashboards.<action>.<name>` once the host composes it; attributes carry no raw id and no SQL.
 * Pure.
 * @see modules/dashboard/specs/dashboards-telemetry.feature
 */

import type { DashboardWidgetQuery } from "@langwatch/analytics-contract/dashboard-widget-definition";
import type { UiAnalyticsEvent } from "@langwatch/browser-host/analytics";
import { LANGY_TRACE_ORIGIN } from "@langwatch/trace-contract";

export const DASHBOARDS_BOUNDARY = "dashboards";

/** A board the member made and can change, or a From LangWatch board read live. */
export type DashboardKind = "stored" | "curated";

/** How a board was made. */
export type DashboardCreatedFrom = "blank" | "template" | "duplicate" | "duplicate_curated";

/** How a widget landed on a board. */
export type WidgetAddedFrom = "catalogue" | "editor" | "duplicate";

/** Whether a Langy ask was sent outright or seeded into the composer for the member to send. */
export type LangyAskKind = "question" | "draft";

function dashboardsEvent(
  name: string,
  action: string,
  attributes: Readonly<Record<string, unknown>> = {},
): UiAnalyticsEvent {
  return { boundary: DASHBOARDS_BOUNDARY, name, action, attributes };
}

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

export function dashboardDeleted(): UiAnalyticsEvent {
  return dashboardsEvent("dashboard", "deleted");
}

export function dashboardFavourited({ starred }: { starred: boolean }): UiAnalyticsEvent {
  return dashboardsEvent("dashboard", "favourited", { starred });
}

export function widgetAdded({
  addedFrom,
  widgetCount = 1,
}: {
  addedFrom: WidgetAddedFrom;
  widgetCount?: number;
}): UiAnalyticsEvent {
  return dashboardsEvent("widget", "added", { addedFrom, widgetCount });
}

export function widgetEdited(): UiAnalyticsEvent {
  return dashboardsEvent("widget", "edited");
}

export function widgetDeleted(): UiAnalyticsEvent {
  return dashboardsEvent("widget", "deleted");
}

export function langyAsked({ askKind }: { askKind: LangyAskKind }): UiAnalyticsEvent {
  return dashboardsEvent("langy", "asked", { askKind });
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

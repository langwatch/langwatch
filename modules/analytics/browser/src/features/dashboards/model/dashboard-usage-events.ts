/**
 * The product events Dashboards sends, built here so every call site names them alike. Each is
 * `dashboards.<action>.<name>` once the host composes it; attributes carry no raw id and no SQL.
 * Pure.
 * @see modules/dashboard/specs/dashboards-telemetry.feature
 */

import type {
  DashboardWidgetDefinition,
  DashboardWidgetQuery,
} from "@langwatch/analytics-contract/dashboard-widget-definition";
import type { UiAnalyticsEvent } from "@langwatch/browser-host/analytics";
import { LANGY_TRACE_ORIGIN } from "@langwatch/trace-contract";

import type { BoardPeriodGrain, BoardPeriodRange } from "./board-period.ts";

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
  dashboardKey,
}: {
  dashboardKind: DashboardKind;
  widgetCount: number;
  templateId?: string;
  /** The board's {@link dashboardKey}, so repeat opens of one board can be counted. */
  dashboardKey?: string;
}): UiAnalyticsEvent {
  return dashboardsEvent("dashboard", "viewed", {
    dashboardKind,
    widgetCount,
    ...(templateId === void 0 ? {} : { templateId }),
    ...(dashboardKey === void 0 ? {} : { dashboardKey }),
  });
}

/**
 * A one-way key for a board: the first 16 hex characters of the SHA-256 of its id. Product
 * events carry no raw id, yet repeat opens of one board must still count as one board.
 */
export async function dashboardKey(dashboardId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(dashboardId));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

/** How a board was changed, apart from its widgets. */
export type DashboardEditChange = "rename" | "layout";

/** A board's own change saved: "dashboards.edited.dashboard". One per save, not per drag. */
export function dashboardEdited({ change }: { change: DashboardEditChange }): UiAnalyticsEvent {
  return dashboardsEvent("dashboard", "edited", { change });
}

/** The board period the member picked: "dashboards.changed.period". */
export function periodChanged({
  range,
  grain,
}: {
  range: BoardPeriodRange;
  grain: BoardPeriodGrain;
}): UiAnalyticsEvent {
  return dashboardsEvent("period", "changed", { range, grain });
}

/** Where a widget on screen came from; "curated" for a From LangWatch board's widget. */
export type WidgetSource =
  | NonNullable<DashboardWidgetDefinition["source"]>["kind"]
  | "curated"
  | "unknown";

/** A widget first on screen in a board view: "dashboards.viewed.widget". */
export function widgetViewed({ widgetSource }: { widgetSource: WidgetSource }): UiAnalyticsEvent {
  return dashboardsEvent("widget", "viewed", { widgetSource });
}

/** A widget's rows downloaded: "dashboards.exported.widget". */
export function widgetExported({ format }: { format: "csv" }): UiAnalyticsEvent {
  return dashboardsEvent("widget", "exported", { format });
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

/** A question a member submitted in a board's Langy box; never a draft the app seeds. */
export function langyAsked(): UiAnalyticsEvent {
  return dashboardsEvent("langy", "asked");
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

/** The boundary the LangWatchQL editor's product events are sent under. */
export const LWQL_BOUNDARY = "lwql";

/** The widget editor, the product's LangWatchQL workbench, opened: "lwql.opened.workbench". */
export function workbenchOpened({ widgetIs }: { widgetIs: "new" | "existing" }): UiAnalyticsEvent {
  return { boundary: LWQL_BOUNDARY, name: "workbench", action: "opened", attributes: { widgetIs } };
}

/** A query the member ran from the editor: "lwql.ran.query". Never its text. */
export function queryRan(): UiAnalyticsEvent {
  return { boundary: LWQL_BOUNDARY, name: "query", action: "ran", attributes: {} };
}

import type { GraphLayout, SavedWorkbenchChartDefinition } from "@langwatch/dashboard-contract";
import { Temporal, toDate } from "@langwatch/time";

import type { BoardRecord } from "../board.repository.ts";
import type { DashboardWidgetRow } from "../dashboard-widget.repository.ts";
import type { DashboardRecord, GraphRecord } from "../dashboard.repository.ts";

/** A CustomGraph kind: Reports' two, and the stale srcdoc copies the split left behind. */
type StoredChartKind = "builder" | "workbench_sql" | "dashboard_srcdoc";

/** One CustomGraph row; `graph` is a builder payload or a saved chart's definition. */
export type StoredChart = GraphLayout &
  Pick<GraphRecord, "createdAt" | "updatedAt"> & {
    id: string;
    projectId: string;
    name: string;
    kind: StoredChartKind;
    graph: Record<string, unknown> | SavedWorkbenchChartDefinition;
    filters: Record<string, unknown> | null;
    dashboardId: string | null;
  };

/** One member's star on a board or a template, in their own order within a project. */
export type StoredFavourite = {
  id: string;
  userId: string;
  dashboardId: string | null;
  templateId: string | null;
  projectId: string;
  position: number;
};

/**
 * The dashboard module's five tables in memory, shared by its memory repositories so one's
 * write is the other's read, as in Postgres: Dashboard, CustomGraph, DashboardFavourite,
 * DashboardsV2 and DashboardWidget.
 */
export class MemoryDashboardDatabase {
  dashboards: DashboardRecord[] = [];
  charts: StoredChart[] = [];
  favourites: StoredFavourite[] = [];
  boards: BoardRecord[] = [];
  widgets: DashboardWidgetRow[] = [];
  #clock = 0;
  #favouriteId = 0;

  private constructor() {}

  static create(): MemoryDashboardDatabase {
    return new MemoryDashboardDatabase();
  }

  /** A monotonic clock, so "the newest row" is the one written last. */
  now(): GraphRecord["createdAt"] {
    this.#clock += 1;
    return toDate(Temporal.Instant.fromEpochMilliseconds(this.#clock));
  }

  nextFavouriteId(): string {
    this.#favouriteId += 1;
    return `fav_${this.#favouriteId}`;
  }

  /** Whether the id is a board only Dashboards holds: in DashboardsV2, with no Reports chart. */
  isDashboardsOnly(input: { projectId: string; dashboardId: string }): boolean {
    const copied = this.boards.some(
      (board) => board.id === input.dashboardId && board.projectId === input.projectId,
    );
    return (
      copied &&
      !this.charts.some(
        (chart) =>
          chart.projectId === input.projectId &&
          chart.dashboardId === input.dashboardId &&
          chart.kind !== "dashboard_srcdoc",
      )
    );
  }
}

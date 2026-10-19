import type { BoardRepository } from "./board.repository.ts";
import type { DashboardWidgetRepository } from "./dashboard-widget.repository.ts";
import type { DashboardRepository } from "./dashboard.repository.ts";
import type { SavedViewRepository } from "./saved-view.repository.ts";

export interface DashboardRepositories {
  /** The Dashboards area's boards and stars (DashboardsV2, DashboardFavourite). */
  readonly boards: BoardRepository;
  /** The Analytics Reports boards and charts (Dashboard, CustomGraph). */
  readonly dashboards: DashboardRepository;
  readonly dashboardWidgets: DashboardWidgetRepository;
  readonly savedViews: SavedViewRepository;
}

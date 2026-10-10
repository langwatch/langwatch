import type { DashboardWidgetRepository } from "./dashboard-widget.repository.ts";
import type { DashboardRepository } from "./dashboard.repository.ts";
import type { SavedViewRepository } from "./saved-view.repository.ts";

export interface DashboardRepositories {
  readonly dashboards: DashboardRepository;
  readonly dashboardWidgets: DashboardWidgetRepository;
  readonly savedViews: SavedViewRepository;
}

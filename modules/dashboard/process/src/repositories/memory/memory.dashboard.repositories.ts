import type { DashboardRepositories } from "../dashboard.repositories.ts";
import { MemoryDashboardWidgetRepository } from "./memory.dashboard-widget.repository.ts";
import { MemoryDashboardRepository } from "./memory.dashboard.repository.ts";
import { MemorySavedViewRepository } from "./memory.saved-view.repository.ts";

export class MemoryDashboardRepositories {
  static readonly requires = [] as const;

  static create(): DashboardRepositories {
    const dashboardWidgets = MemoryDashboardWidgetRepository.create();
    return {
      dashboards: MemoryDashboardRepository.create({ widgets: dashboardWidgets }),
      dashboardWidgets,
      savedViews: MemorySavedViewRepository.create(),
    };
  }
}

import type { DashboardRepositories } from "../dashboard.repositories.ts";
import { MemoryBoardRepository } from "./memory.board.repository.ts";
import { MemoryDashboardWidgetRepository } from "./memory.dashboard-widget.repository.ts";
import { MemoryDashboardDatabase } from "./memory.dashboard.database.ts";
import { MemoryDashboardRepository } from "./memory.dashboard.repository.ts";
import { MemorySavedViewRepository } from "./memory.saved-view.repository.ts";

export class MemoryDashboardRepositories {
  static readonly requires = [] as const;

  static create(): DashboardRepositories {
    const database = MemoryDashboardDatabase.create();
    return {
      boards: MemoryBoardRepository.create({ database }),
      dashboards: MemoryDashboardRepository.create({ database }),
      dashboardWidgets: MemoryDashboardWidgetRepository.create({ database }),
      savedViews: MemorySavedViewRepository.create(),
    };
  }
}

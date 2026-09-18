import type { DashboardRepositories } from "../dashboard.repositories.ts";
import { MemoryDashboardRepository } from "./memory.dashboard.repository.ts";
import { MemorySavedViewRepository } from "./memory.saved-view.repository.ts";

export class MemoryDashboardRepositories {
  static readonly requires = [] as const;

  static create(): DashboardRepositories {
    return {
      dashboards: MemoryDashboardRepository.create(),
      savedViews: MemorySavedViewRepository.create(),
    };
  }
}

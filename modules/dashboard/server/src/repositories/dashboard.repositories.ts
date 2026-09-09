import type { DashboardRepository } from "./dashboard.repository.ts";
import type { SavedViewRepository } from "./saved-view.repository.ts";

export interface DashboardRepositories {
  readonly dashboards: DashboardRepository;
  readonly savedViews: SavedViewRepository;
}

import type { LangWatchQLService } from "@langwatch/analytics-contract";
import type { DashboardService as DashboardServiceContract } from "@langwatch/dashboard-contract";
import type {
  DashboardIdGenerator,
  DashboardGraphVisibilityPolicyPort,
  SavedWorkbenchChartPolicy,
} from "../ports/dashboard.port";
import {
  PrismaDashboardRepository,
  type DashboardDatabase,
} from "../repositories/prisma/prisma.dashboard.repository";
import { DashboardService } from "../services/dashboard.service";

export class PostgresDashboardAdapter {
  private constructor(
    private readonly options: {
      database: DashboardDatabase;
      ids: DashboardIdGenerator;
      savedWorkbenchChartPolicy: SavedWorkbenchChartPolicy;
      graphVisibility: DashboardGraphVisibilityPolicyPort;
      langWatchQL: LangWatchQLService;
    },
  ) {}

  static create(options: {
    database: DashboardDatabase;
    ids: DashboardIdGenerator;
    savedWorkbenchChartPolicy: SavedWorkbenchChartPolicy;
    graphVisibility: DashboardGraphVisibilityPolicyPort;
    langWatchQL: LangWatchQLService;
  }): PostgresDashboardAdapter {
    return new PostgresDashboardAdapter(options);
  }

  build(): DashboardServiceContract {
    return DashboardService.create({
      repository: PrismaDashboardRepository.create(this.options.database),
      ids: this.options.ids,
      savedWorkbenchChartPolicy: this.options.savedWorkbenchChartPolicy,
      graphVisibility: this.options.graphVisibility,
      langWatchQL: this.options.langWatchQL,
    });
  }
}

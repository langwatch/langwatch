import type { DashboardService as DashboardServiceContract } from "@langwatch/dashboard-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type {
  DashboardIdGenerator,
  SavedWorkbenchChartPolicy,
} from "../ports/dashboard.port";
import { PrismaDashboardRepository } from "../repositories/prisma/prisma.dashboard.repository";
import { DashboardService } from "../services/dashboard.service";

export class PostgresDashboardAdapter {
  private constructor(
    private readonly options: {
      database: PrismaClient;
      ids: DashboardIdGenerator;
      savedWorkbenchChartPolicy: SavedWorkbenchChartPolicy;
    },
  ) {}

  static create(options: {
    database: PrismaClient;
    ids: DashboardIdGenerator;
    savedWorkbenchChartPolicy: SavedWorkbenchChartPolicy;
  }): PostgresDashboardAdapter {
    return new PostgresDashboardAdapter(options);
  }

  build(): DashboardServiceContract {
    return DashboardService.create({
      repository: PrismaDashboardRepository.create(this.options.database),
      ids: this.options.ids,
      savedWorkbenchChartPolicy: this.options.savedWorkbenchChartPolicy,
    });
  }
}

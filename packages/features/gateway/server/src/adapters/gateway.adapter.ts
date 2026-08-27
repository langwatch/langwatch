import type { GatewayBudgetSpendPort } from "../ports/gateway-budget-spend.port";
import {
  PrismaGatewayBudgetRepository,
  type GatewayDatabase,
} from "../repositories/prisma/prisma.gateway-budget.repository";
import { GatewayService } from "../services/gateway.service";
import type { ProjectService } from "@langwatch/project-contract";

/** Binds Gateway's private budget repository to its canonical service. */
export class PrismaGatewayAdapter {
  private constructor(
    private readonly repository: PrismaGatewayBudgetRepository,
    private readonly projects: ProjectService,
  ) {}

  static create(options: {
    database: GatewayDatabase;
    projects: ProjectService;
    budgetSpend?: GatewayBudgetSpendPort;
  }): PrismaGatewayAdapter {
    const repository = PrismaGatewayBudgetRepository.create(
      options.database,
      options.budgetSpend,
    );
    return new PrismaGatewayAdapter(repository, options.projects);
  }

  build(): GatewayService {
    return GatewayService.create(this.repository, this.projects);
  }
}

import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { GatewayBudgetClickHouseRepository } from "../gateway-budget-clickhouse.repository";
import { PrismaGatewayBudgetRepository } from "../repositories/prisma.gateway-budget.repository";
import { GatewayService } from "../services/gateway.service";

/** Binds the process Prisma client and optional ClickHouse spend reader. */
export class PrismaGatewayAdapter {
  private constructor(
    private readonly database: PrismaClient,
    private readonly clickHouse?: GatewayBudgetClickHouseRepository,
  ) {}

  static create(options: {
    database: PrismaClient;
    clickHouse?: GatewayBudgetClickHouseRepository;
  }): PrismaGatewayAdapter {
    return new PrismaGatewayAdapter(options.database, options.clickHouse);
  }

  build(): GatewayService {
    return GatewayService.create({
      repository: PrismaGatewayBudgetRepository.create(
        this.database,
        this.clickHouse,
      ),
    });
  }
}

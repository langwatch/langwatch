import type { GatewayBudgetSpend } from "../app/gateway.members.ts";
import {
  type GatewayBudgetDatabase,
  PrismaGatewayBudgetRepository,
} from "../repositories/prisma/prisma.gateway-budget.repository.ts";
import { GatewayEndUserCapsService } from "../services/gateway-end-user-caps.service.ts";

/**
 * The composition seam for end-user caps: wires PrismaClient and the spend
 * port here, keeping the Prisma repository private (`private-runtime-export`).
 */

export class GatewayEndUserCapsAdapter {
  private constructor() {}

  static create(options: {
    database: GatewayBudgetDatabase;
    spend: GatewayBudgetSpend;
  }): GatewayEndUserCapsService {
    return GatewayEndUserCapsService.create({
      budgets: PrismaGatewayBudgetRepository.create(options.database, options.spend),
      spend: options.spend,
    });
  }
}

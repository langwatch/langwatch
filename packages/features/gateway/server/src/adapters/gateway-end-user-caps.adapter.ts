import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { GatewayBudgetSpendPort } from "../ports/gateway-budget-spend.port";
import { PrismaGatewayBudgetRepository } from "../repositories/prisma/prisma.gateway-budget.repository";
import { GatewayEndUserCapsService } from "../services/gateway-end-user-caps.service";

/**
 * The composition seam for end-user caps.
 *
 * A process has a PrismaClient and a spend port; the service wants a budget
 * repository. Wiring one to the other is composition, so it happens here
 * rather than in the service — and the Prisma repository stays private to the
 * package, which is what `private-runtime-export` asks for.
 */
export class GatewayEndUserCapsAdapter {
  private constructor() {}

  static create(options: {
    database: PrismaClient;
    spend: GatewayBudgetSpendPort;
  }): GatewayEndUserCapsService {
    return GatewayEndUserCapsService.create({
      budgets: PrismaGatewayBudgetRepository.create(options.database, options.spend),
      spend: options.spend,
    });
  }
}

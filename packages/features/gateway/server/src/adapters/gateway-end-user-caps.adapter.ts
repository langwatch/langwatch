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
/**
 * Whatever the budget repository accepts as its database handle. Taken from
 * that factory rather than imported, because generated Prisma belongs below
 * `repositories/prisma` and an adapter naming it would be a second place the
 * containment rule has to be argued about.
 */
type BudgetDatabase = Parameters<typeof PrismaGatewayBudgetRepository.create>[0];

export class GatewayEndUserCapsAdapter {
  private constructor() {}

  static create(options: {
    database: BudgetDatabase;
    spend: GatewayBudgetSpendPort;
  }): GatewayEndUserCapsService {
    return GatewayEndUserCapsService.create({
      budgets: PrismaGatewayBudgetRepository.create(options.database, options.spend),
      spend: options.spend,
    });
  }
}

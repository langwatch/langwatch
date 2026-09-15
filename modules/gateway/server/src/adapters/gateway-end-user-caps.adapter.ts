import type { GatewayBudgetSpend } from "../app/gateway.members.ts";
import { PrismaGatewayBudgetRepository } from "../repositories/prisma/prisma.gateway-budget.repository.ts";
import { GatewayEndUserCapsService } from "../services/gateway-end-user-caps.service.ts";

/**
 * The composition seam for end-user caps: wires the process's PrismaClient
 * and spend port to what the service needs, here rather than in the service
 * — keeping the Prisma repository private, per `private-runtime-export`.
 * `BudgetDatabase` is taken from the repository's own factory rather than
 * imported, so an adapter never names generated Prisma directly — a second
 * place the containment rule would have to be argued.
 */
type BudgetDatabase = Parameters<typeof PrismaGatewayBudgetRepository.create>[0];

export class GatewayEndUserCapsAdapter {
  private constructor() {}

  static create(options: {
    database: BudgetDatabase;
    spend: GatewayBudgetSpend;
  }): GatewayEndUserCapsService {
    return GatewayEndUserCapsService.create({
      budgets: PrismaGatewayBudgetRepository.create(options.database, options.spend),
      spend: options.spend,
    });
  }
}

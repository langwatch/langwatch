import type {
  GatewayApi,
  GatewayBudgetResolutionTarget,
  GatewayResolvedBudget,
} from "@langwatch/gateway-contract";
import {
  PrismaGatewayBudgetRepository,
  type GatewayBudgetDatabase,
} from "../repositories/prisma/prisma.gateway-budget.repository.ts";

/** The Prisma models the budget resolution read binds to. */
export type GatewayBudgetResolutionDatabase = GatewayBudgetDatabase;

/** The one gateway operation the spend graph's debit path calls. */
export type GatewayBudgetResolutionApi = Pick<GatewayApi, "resolveApplicableBudgets">;

/**
 * The ONE read the spend graph's debit path makes into Gateway.
 *
 * Composing the whole gateway application to satisfy that one call means
 * building a `ProjectApi`, an `EvaluatorService` and a `MonitorService` - the
 * write graph behind the budget CRUD, the guardrail catalogue and the cache
 * rules, none of which a spend debit reaches. That is the same trade
 * `worker-trace-capability-services.composition.ts` records for the
 * record-span path, and the same answer applies: publish the read half. The
 * consumer names that half by its operation now, so nothing else has to be
 * refused by name.
 */
export class PostgresGatewayBudgetResolutionAdapter implements GatewayBudgetResolutionApi {
  static create(options: {
    database: GatewayBudgetResolutionDatabase;
  }): PostgresGatewayBudgetResolutionAdapter {
    return new PostgresGatewayBudgetResolutionAdapter(
      PrismaGatewayBudgetRepository.create(options.database),
    );
  }

  private constructor(private readonly budgets: PrismaGatewayBudgetRepository) {}

  resolveApplicableBudgets(input: GatewayBudgetResolutionTarget): Promise<GatewayResolvedBudget[]> {
    return this.budgets.resolveApplicableBudgets(input);
  }
}

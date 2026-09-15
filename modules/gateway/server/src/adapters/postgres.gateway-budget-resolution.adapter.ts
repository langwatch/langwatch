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
 * The ONE read the spend graph's debit path makes into Gateway. Composing
 * the whole gateway app for it would drag in the write graph behind budget
 * CRUD, the guardrail catalogue and cache rules — none of which a debit
 * reaches. Same trade as `worker-trace-capability-services.composition.ts`
 * for record-span: publish just the read half, named by its operation.
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

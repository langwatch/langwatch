import {
  GatewayService as GatewayServiceContract,
  type GatewayBudgetResolutionTarget,
  type GatewayResolvedBudget,
} from "@langwatch/gateway-contract";
import {
  PrismaGatewayBudgetRepository,
  type GatewayBudgetDatabase,
} from "../repositories/prisma/prisma.gateway-budget.repository";

/** The Prisma models the budget resolution read binds to. */
export type GatewayBudgetResolutionDatabase = GatewayBudgetDatabase;

/**
 * The ONE read the spend graph's debit path makes into Gateway.
 *
 * `AppGatewayGovernancePort` names the whole `GatewayService` and calls exactly
 * `resolveApplicableBudgets` on it. Composing the whole service to satisfy that
 * one call means building a `ProjectService`, an `EvaluatorService` and a
 * `MonitorService` — the write graph behind the budget CRUD, the guardrail
 * catalogue and the cache rules, none of which a spend debit reaches. That is
 * the same trade `worker-trace-capability-services.composition.ts` records for
 * the record-span path, and the same answer applies: publish the read half.
 *
 * WHY THIS EXTENDS THE CONTRACT RATHER THAN NARROWING IT. The consumer's
 * parameter is nominally typed to the contract class, in a package this one may
 * not edit, so the shape is not negotiable here. Every other member therefore
 * REFUSES BY NAME. A stub that answered an empty list or a null would let a
 * budget listing, a guardrail read or a cache-rule write appear to succeed
 * against a graph that never composed them — the failure would arrive as a
 * customer's budget silently missing from a screen rather than as a sentence in
 * a log.
 */
export class PostgresGatewayBudgetResolutionAdapter extends GatewayServiceContract {
  static create(options: {
    database: GatewayBudgetResolutionDatabase;
  }): PostgresGatewayBudgetResolutionAdapter {
    return new PostgresGatewayBudgetResolutionAdapter(
      PrismaGatewayBudgetRepository.create(options.database),
    );
  }

  private constructor(private readonly budgets: PrismaGatewayBudgetRepository) {
    super();
  }

  resolveApplicableBudgets(
    input: GatewayBudgetResolutionTarget,
  ): Promise<GatewayResolvedBudget[]> {
    return this.budgets.resolveApplicableBudgets(input);
  }

  private unavailable(operation: string): never {
    throw new Error(
      `Gateway ${operation} is not composed in this process; it holds the budget resolution read alone.`,
    );
  }

  checkBudget(): never {
    this.unavailable("checkBudget");
  }
  list(): never {
    this.unavailable("list");
  }
  listForProject(): never {
    this.unavailable("listForProject");
  }
  listWithHealth(): never {
    this.unavailable("listWithHealth");
  }
  listForProjectWithHealth(): never {
    this.unavailable("listForProjectWithHealth");
  }
  listPageWithHealth(): never {
    this.unavailable("listPageWithHealth");
  }
  tryGet(): never {
    this.unavailable("tryGet");
  }
  tryGetWithHealth(): never {
    this.unavailable("tryGetWithHealth");
  }
  tryGetDetail(): never {
    this.unavailable("tryGetDetail");
  }
  scopeReach(): never {
    this.unavailable("scopeReach");
  }
  create(): never {
    this.unavailable("create");
  }
  update(): never {
    this.unavailable("update");
  }
  archive(): never {
    this.unavailable("archive");
  }
  reset(): never {
    this.unavailable("reset");
  }
  resolveScopeTargets(): never {
    this.unavailable("resolveScopeTargets");
  }
  listSpendTenantIds(): never {
    this.unavailable("listSpendTenantIds");
  }
  cacheRuleList(): never {
    this.unavailable("cacheRuleList");
  }
  cacheRuleListPage(): never {
    this.unavailable("cacheRuleListPage");
  }
  tryCacheRuleGet(): never {
    this.unavailable("tryCacheRuleGet");
  }
  cacheRuleCreate(): never {
    this.unavailable("cacheRuleCreate");
  }
  cacheRuleUpdate(): never {
    this.unavailable("cacheRuleUpdate");
  }
  cacheRuleArchive(): never {
    this.unavailable("cacheRuleArchive");
  }
  guardrailList(): never {
    this.unavailable("guardrailList");
  }
  tryGuardrailGet(): never {
    this.unavailable("tryGuardrailGet");
  }
  guardrailCreate(): never {
    this.unavailable("guardrailCreate");
  }
  guardrailUpdate(): never {
    this.unavailable("guardrailUpdate");
  }
  guardrailArchive(): never {
    this.unavailable("guardrailArchive");
  }
  loadConfigurationPersistence(): never {
    this.unavailable("loadConfigurationPersistence");
  }
}

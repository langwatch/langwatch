import { bucketPeriodFloorMs, effectiveBudgetPeriod } from "../adapters/gateway-period.adapter";
import {
  attributedUserBucketScopeId,
  bucketScopeIdFor,
} from "../adapters/gateway-bucket-scope.adapter";
import { toWireEnum } from "@langwatch/gateway-contract";
import { usdDisplayString } from "@langwatch/gateway-contract";
import type { GatewayBudgetSpendPort } from "../ports/gateway-budget-spend.port";
import type {
  AttributedUserBudgetTemplate,
  GatewayBudgetRepository,
} from "../repositories/gateway-budget.repository";

/**
 * The attributed-user budget allowances that apply to one end user, with what
 * each has spent.
 *
 * Two stores answer this: the templates and their bucket boundaries come from
 * Postgres through the budget repository, the spend from the ledger through
 * the spend port. Neither is a PrismaClient — this used to take one and query
 * it directly, which put a database handle in a service.
 */
export class GatewayEndUserCapsService {
  static create(options: {
    budgets: GatewayBudgetRepository;
    spend: GatewayBudgetSpendPort;
  }): GatewayEndUserCapsService {
    return new GatewayEndUserCapsService(options.budgets, options.spend);
  }

  private constructor(
    private readonly budgets: GatewayBudgetRepository,
    private readonly spend: GatewayBudgetSpendPort,
  ) {}

  async forEndUser(input: {
    organizationId: string;
    endUserId: string;
    tenantIds: string[];
    virtualKeyId?: string;
  }): Promise<Array<Record<string, unknown>>> {
    const templates = await this.budgets.findAttributedUserTemplates({
      organizationId: input.organizationId,
      ...(input.virtualKeyId ? { virtualKeyId: input.virtualKeyId } : {}),
    });
    if (templates.length === 0 || input.tenantIds.length === 0) {
      return [];
    }

    const boundaries = await this.budgets.findBucketBoundaries({
      organizationId: input.organizationId,
      budgetIds: templates.map((template) => template.id),
    });
    const boundaryByKey = new Map(
      boundaries.map((boundary) => [`${boundary.budgetId}:${boundary.bucketScopeId}`, boundary]),
    );
    const bucketFor = (template: AttributedUserBudgetTemplate) =>
      bucketScopeIdFor(template, attributedUserBucketScopeId(template.scopeId, input.endUserId));

    const now = new Date();
    const targets = templates.map((template) => {
      const bucketScopeId = bucketFor(template);
      return {
        budgetId: template.id,
        scope: template.scopeType,
        scopeId: bucketScopeId,
        window: template.window,
        match: "exact" as const,
        periodFloorMs: bucketPeriodFloorMs(
          template,
          boundaryByKey.get(`${template.id}:${bucketScopeId}`)?.periodStartedAt,
          now,
        ),
      };
    });
    const spends = await this.spend.getSpendForTargetsAcrossTenants(input.tenantIds, targets, now);
    const spentByBudget = new Map(spends.map((entry) => [entry.budgetId, entry.spentUsd]));

    return templates.map((template) => {
      const boundary = boundaryByKey.get(`${template.id}:${bucketFor(template)}`);
      const periodFloorMs = bucketPeriodFloorMs(template, boundary?.periodStartedAt, now);
      return {
        budget_id: template.id,
        anchor_id: template.scopeId,
        window: toWireEnum(template.window),
        on_breach: toWireEnum(template.onBreach),
        limit_usd: usdDisplayString(template.limitUsd),
        spent_usd: usdDisplayString(spentByBudget.get(template.id) ?? "0"),
        period_started_at: new Date(
          periodFloorMs ?? effectiveBudgetPeriod(template, now).currentPeriodStartedAt.getTime(),
        ).toISOString(),
      };
    });
  }
}

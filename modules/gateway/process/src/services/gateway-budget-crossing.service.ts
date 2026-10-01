import {
  computeBucketPeriodFloorMs,
  currentPeriodStart,
  type GatewayResolvedBudget,
  type RecordBudgetCrossingCommandData,
} from "@langwatch/gateway-contract";
import { nowInstant, type Instant } from "@langwatch/time";

import type { BudgetSpendTarget, GatewayBudgetSpend } from "../app/gateway.members.ts";
import { budgetCrossingKind } from "../rules/gateway-budget-crossing.rules.ts";
import type { GatewayGovernanceEventsService } from "./gateway-governance-events.service.ts";
import type { GatewayService } from "./gateway.service.ts";

type GatewayBudgetCrossingCollaborators = Readonly<{
  budgets: Pick<GatewayService, "listSpendTenantIds" | "findBucketBoundaries">;
  spend: Pick<GatewayBudgetSpend, "getSpendForTargetsAcrossTenants">;
  facts: Pick<GatewayGovernanceEventsService, "recordBudgetCrossing">;
  clock?: () => Instant;
}>;

/**
 * Main's `detectBudgetCrossings` over the buckets just debited, read after the sync
 * insert returned. A failure throws and re-drives the debit safely (ARCHITECTURE §9).
 */
export class GatewayBudgetCrossingService {
  private constructor(private readonly collaborators: GatewayBudgetCrossingCollaborators) {}

  static create(collaborators: GatewayBudgetCrossingCollaborators): GatewayBudgetCrossingService {
    return new GatewayBudgetCrossingService(collaborators);
  }

  async detect({
    tenantId,
    organizationId,
    budgets,
  }: {
    tenantId: string;
    organizationId: string;
    budgets: GatewayResolvedBudget[];
  }): Promise<void> {
    const written = this.distinctBuckets(budgets.filter(({ budget }) => !budget.archivedAt));
    if (written.length === 0) return;

    const tenantIds = await this.collaborators.budgets.listSpendTenantIds(organizationId);
    if (tenantIds.length === 0) return;

    // One instant anchors the floors, the spend read and the stamped period start.
    const now = (this.collaborators.clock ?? nowInstant)();
    const boundaries = await this.collaborators.budgets.findBucketBoundaries({
      organizationId,
      budgetIds: [...new Set(written.map(({ budget }) => budget.id))],
    });
    const boundaryAt = new Map(
      boundaries.map((b) => [`${b.budgetId}:${b.bucketScopeId}`, b.periodStartedAt]),
    );
    const targets: BudgetSpendTarget[] = written.map(({ budget, bucketScopeId }) => ({
      budgetId: budget.id,
      scope: budget.scopeType,
      scopeId: bucketScopeId,
      window: budget.window,
      match: "exact",
      periodFloorMs: computeBucketPeriodFloorMs(
        budget,
        boundaryAt.get(`${budget.id}:${bucketScopeId}`),
        now,
      ),
    }));
    const spends = await this.collaborators.spend.getSpendForTargetsAcrossTenants(
      tenantIds,
      targets,
      now,
    );
    const spentByBudget = new Map(spends.map((s) => [s.budgetId, s.spentUsd]));

    for (const [index, resolved] of written.entries()) {
      const crossing = this.crossingFor({
        tenantId,
        resolved,
        spentUsd: spentByBudget.get(resolved.budget.id),
        periodFloorMs: targets[index]?.periodFloorMs,
        now,
      });
      if (crossing) await this.collaborators.facts.recordBudgetCrossing(crossing);
    }
  }

  private distinctBuckets(budgets: GatewayResolvedBudget[]): GatewayResolvedBudget[] {
    return [...new Map(budgets.map((b) => [`${b.budget.id}:${b.bucketScopeId}`, b])).values()];
  }

  /** The crossing one written bucket records, or null below the warn line. */
  private crossingFor({
    tenantId,
    resolved,
    spentUsd,
    periodFloorMs,
    now,
  }: {
    tenantId: string;
    resolved: GatewayResolvedBudget;
    spentUsd: string | undefined;
    periodFloorMs: number | undefined;
    now: Instant;
  }): RecordBudgetCrossingCommandData | null {
    const { budget, bucketScopeId, endUserId } = resolved;
    const spent = Number.parseFloat(spentUsd ?? "0") || 0;
    const limit = Number.parseFloat(budget.limitUsd.toString()) || 0;
    const kind = budgetCrossingKind({ spentUsd: spent, limitUsd: limit });
    if (kind === "not_crossed") return null;

    return {
      tenantId,
      organization_id: budget.organizationId,
      budget_id: budget.id,
      kind,
      scope_type: budget.scopeType.toLowerCase(),
      bucket_scope_id: bucketScopeId,
      end_user_id: endUserId,
      virtual_key_id:
        budget.scopeType === "VIRTUAL_KEY" || budget.scopeType === "ATTRIBUTED_USER"
          ? budget.scopeId
          : null,
      anchor_project_id: budget.scopeType === "PROJECT" ? budget.scopeId : null,
      window: budget.window,
      period_started_at_ms:
        periodFloorMs ?? currentPeriodStart(budget.window, now).epochMilliseconds,
      limit_usd: limit.toFixed(6),
      spent_usd: spent.toFixed(6),
      on_breach: budget.onBreach === "BLOCK" ? "block" : "warn",
      occurred_at: now.epochMilliseconds,
    };
  }
}

import {
  computeBucketPeriodFloorMs,
  currentPeriodStart,
  type GatewayResolvedBudget,
  type RecordBudgetCrossingCommandData,
} from "@langwatch/gateway-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant, type Instant } from "@langwatch/time";

import type {
  BudgetSpendTarget,
  GatewayBudgetSpendRepository,
} from "../../../repositories/gateway-budget-spend.repository.ts";
import {
  budgetCrossingKind,
  type BucketTopModel,
  computePeriodEndsAtMs,
  topModelOf,
} from "../../../rules/gateway-budget-crossing.rules.ts";
import type { GatewayGovernanceEventsService } from "../../../services/gateway-governance-events.service.ts";
import type { GatewayService } from "../../../services/gateway.service.ts";

const logger = createLogger("langwatch:gateway:budget-crossing");

/**
 * How many crossings' top models one process remembers. Every debit past the warn line records
 * its crossing again (the append dedupes), so without the memo each would cost a by-model read.
 */
const TOP_MODEL_MEMO_SIZE = 1_000;

type GatewayBudgetCrossingCollaborators = Readonly<{
  budgets: Pick<GatewayService, "listSpendTenantIds" | "findBucketBoundaries">;
  spend: Pick<
    GatewayBudgetSpendRepository,
    "findSpendForTargetsAcrossTenants" | "findModelSpendForTarget"
  >;
  facts: Pick<GatewayGovernanceEventsService, "recordBudgetCrossing">;
  clock?: () => Instant;
}>;

/**
 * Main's `detectBudgetCrossings` over the buckets just debited, read after the sync
 * insert returned. A failure throws and re-drives the debit safely (ARCHITECTURE §9).
 * A key's own budget also names the model it spent most on; that read never fails the debit.
 */
export class GatewayBudgetCrossingService {
  readonly #topModels = new Map<string, BucketTopModel>();

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
    const spends = await this.collaborators.spend.findSpendForTargetsAcrossTenants(
      tenantIds,
      targets,
      now,
    );
    const spentByBudget = new Map(spends.map((s) => [s.budgetId, s.spentUsd]));

    for (const [index, resolved] of written.entries()) {
      const target = targets[index];
      const crossing = this.crossingFor({
        tenantId,
        resolved,
        spentUsd: spentByBudget.get(resolved.budget.id),
        periodFloorMs: target?.periodFloorMs,
        now,
      });
      if (!crossing) continue;
      const topModel: BucketTopModel =
        target && resolved.budget.scopeType === "VIRTUAL_KEY"
          ? await this.topModelFor({ crossing, tenantIds, target })
          : { outcome: "none" };
      await this.collaborators.facts.recordBudgetCrossing(
        topModel.outcome === "named"
          ? { ...crossing, top_model: topModel.model, top_model_spend_share: topModel.share }
          : crossing,
      );
    }
  }

  private distinctBuckets(budgets: GatewayResolvedBudget[]): GatewayResolvedBudget[] {
    return [...new Map(budgets.map((b) => [`${b.budget.id}:${b.bucketScopeId}`, b])).values()];
  }

  /**
   * The model the crossing's bucket spent most on over the period it stamped, read once per
   * crossing in this process. A failed read is logged and leaves the crossing without one: the
   * debit must not be re-driven for a figure no budget enforces.
   */
  private async topModelFor({
    crossing,
    tenantIds,
    target,
  }: {
    crossing: RecordBudgetCrossingCommandData;
    tenantIds: string[];
    target: BudgetSpendTarget;
  }): Promise<BucketTopModel> {
    // The crossing's own idempotency identity: every record of it carries one figure.
    const key = `${crossing.tenantId}:${crossing.budget_id}:${crossing.bucket_scope_id}:${crossing.kind}:${crossing.period_started_at_ms}`;
    const remembered = this.#topModels.get(key);
    if (remembered) return remembered;

    let topModel: BucketTopModel = { outcome: "none" };
    try {
      topModel = topModelOf(
        await this.collaborators.spend.findModelSpendForTarget({
          tenantIds,
          target: { ...target, periodFloorMs: crossing.period_started_at_ms },
        }),
      );
    } catch (error) {
      logger.warn(
        { budgetId: crossing.budget_id, organizationId: crossing.organization_id, error },
        "failed to read a key budget's top model; recording its crossing without one",
      );
    }
    this.remember(key, topModel);
    return topModel;
  }

  private remember(key: string, topModel: BucketTopModel): void {
    if (this.#topModels.size >= TOP_MODEL_MEMO_SIZE) {
      const oldest = this.#topModels.keys().next();
      if (!oldest.done) this.#topModels.delete(oldest.value);
    }
    this.#topModels.set(key, topModel);
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
      period_ends_at_ms: computePeriodEndsAtMs({ budget, now }),
      limit_usd: limit.toFixed(6),
      spent_usd: spent.toFixed(6),
      on_breach: budget.onBreach === "BLOCK" ? "block" : "warn",
      occurred_at: now.epochMilliseconds,
    };
  }
}

import type { IngestedCostRecordedEventData } from "@langwatch/enterprise-governance-contract";
import {
  budgetAppliesToProvider,
  type GatewayBudgetDebitRow,
  type GatewayBudgetLedgerStatus,
  type GatewayResolvedBudget,
} from "@langwatch/gateway-contract";
import { createLogger } from "@langwatch/observability";
import { Temporal } from "@langwatch/time";

import type { WriteGatewayDebitsPayload } from "../../../eventing/gateway-debit.intent.ts";
import type { GatewayBudgetSpendRepository } from "../../../repositories/gateway-budget-spend.repository.ts";
import type { GatewayChangeEventsRepository } from "../../../repositories/gateway-change-event.repository.ts";
import { EMPTY_SPEND_USAGE } from "../../../rules/gateway-spend-projection.rules.ts";
import type { GatewayService } from "../../../services/gateway.service.ts";
import type { BudgetChangeEventDedupeService } from "../../budget/services/gateway-budget-change-dedupe.service.ts";
import type { GatewayBudgetCrossingService } from "../../budget/services/gateway-budget-crossing.service.ts";

const logger = createLogger("langwatch:gateway:spend-debits");

/**
 * The sole writer of gateway budget debits, for the gateway's own requests and for the costs a
 * governance push source recorded: one ledger row per budget the spend applies to, then its
 * crossings, then a BUDGET_UPDATED so the data plane stops enforcing against a stale bundle.
 */
type GatewaySpendDebitCollaborators = Readonly<{
  budgets: Pick<GatewayService, "resolveApplicableBudgets">;
  spend: Pick<GatewayBudgetSpendRepository, "insertDebitsForBudgets">;
  dedupe: BudgetChangeEventDedupeService;
  changes: Pick<GatewayChangeEventsRepository, "append">;
  crossings: Pick<GatewayBudgetCrossingService, "detect">;
}>;

export class GatewaySpendDebitService {
  private constructor(private readonly collaborators: GatewaySpendDebitCollaborators) {}

  static create(collaborators: GatewaySpendDebitCollaborators): GatewaySpendDebitService {
    return new GatewaySpendDebitService(collaborators);
  }

  async write(payload: WriteGatewayDebitsPayload): Promise<void> {
    const providerKey = payload.model_provider_id || null;
    const applicable = await this.collaborators.budgets.resolveApplicableBudgets({
      organizationId: payload.organization_id,
      teamId: payload.team_id || null,
      projectId: payload.project_id,
      virtualKeyId: payload.virtual_key_id,
      principalUserId: payload.principal_user_id || null,
      endUserId: payload.end_user_id || null,
    });
    const budgets = applicable.filter(({ budget }) => budgetAppliesToProvider(budget, providerKey));
    await this.debit({
      projectId: payload.project_id,
      organizationId: payload.organization_id,
      requestId: payload.gateway_request_id,
      budgets,
      rows: () => this.debitRows(payload, budgets, providerKey),
      announcement: (budgetIds) => ({
        gatewayRequestId: payload.gateway_request_id,
        virtualKeyId: payload.virtual_key_id,
        budgetIds,
      }),
    });
  }

  /**
   * A governance push source's recorded cost, debited in the worker rather than in its request.
   * The sentinel key and team cannot be real ids, so TEAM budgets drop out while organization,
   * project and principal budgets match; attributed-user templates need an end user it lacks.
   */
  async writeIngestedCost({
    tenantId,
    fact,
  }: {
    tenantId: string;
    fact: IngestedCostRecordedEventData;
  }): Promise<void> {
    const sentinel = `_ingestion_:${fact.ingestionSourceId}`;
    const applicable = await this.collaborators.budgets.resolveApplicableBudgets({
      organizationId: fact.organizationId,
      teamId: fact.teamId ?? sentinel,
      projectId: tenantId,
      virtualKeyId: sentinel,
      principalUserId: fact.principalUserId,
    });
    const budgets = applicable.filter(({ budget }) => budget.scopeType !== "ATTRIBUTED_USER");
    await this.debit({
      projectId: tenantId,
      organizationId: fact.organizationId,
      requestId: fact.requestId,
      budgets,
      rows: () => this.ingestedRows({ tenantId, fact, budgets, sentinel }),
      announcement: (budgetIds) => ({
        source: "ingestion_source",
        sourceId: fact.ingestionSourceId,
        requestId: fact.requestId,
        budgetIds,
        amountNanoUsd: fact.amountNanoUsd,
      }),
    });
  }

  /** Rows, then crossings, both rethrown for the caller's retry; then the best-effort notice. */
  private async debit({
    projectId,
    organizationId,
    requestId,
    budgets,
    rows,
    announcement,
  }: {
    projectId: string;
    organizationId: string;
    requestId: string;
    budgets: GatewayResolvedBudget[];
    rows: () => GatewayBudgetDebitRow[];
    announcement: (budgetIds: string[]) => Record<string, unknown>;
  }): Promise<void> {
    if (budgets.length === 0) return;

    try {
      await this.collaborators.spend.insertDebitsForBudgets(rows());
    } catch (error) {
      logger.error(
        { projectId, gatewayRequestId: requestId, error },
        "failed to write gateway budget debits",
      );
      // Rethrown for the outbox or subscriber retry: a lost debit under-enforces the cap.
      throw error;
    }

    // Throws for the retry too: the insert skips a budget the request
    // already debited, so a re-drive writes nothing twice.
    await this.collaborators.crossings.detect({ tenantId: projectId, organizationId, budgets });

    await this.announce({
      projectId,
      organizationId,
      requestId,
      budgets,
      payload: announcement(budgets.map(({ budget }) => budget.id)),
    });
  }

  /**
   * Best effort: the rows already landed, and a missed eviction costs freshness
   * until the bundle TTL, never correctness. A blocking budget is never held
   * back by the dedupe window, so enforcement never waits on it.
   */
  private async announce({
    projectId,
    organizationId,
    requestId,
    budgets,
    payload,
  }: {
    projectId: string;
    organizationId: string;
    requestId: string;
    budgets: GatewayResolvedBudget[];
    payload: Record<string, unknown>;
  }): Promise<void> {
    try {
      const blocks = budgets.some(({ budget }) => budget.onBreach === "BLOCK");
      if (!blocks && !(await this.collaborators.dedupe.shouldEmit({ projectId }))) return;
      await this.collaborators.changes.append({
        organizationId,
        projectId,
        kind: "BUDGET_UPDATED",
        payload,
      });
    } catch (error) {
      logger.warn(
        { projectId, gatewayRequestId: requestId, error },
        "failed to emit BUDGET_UPDATED change event after debiting",
      );
    }
  }

  private ingestedRows({
    tenantId,
    fact,
    budgets,
    sentinel,
  }: {
    tenantId: string;
    fact: IngestedCostRecordedEventData;
    budgets: GatewayResolvedBudget[];
    sentinel: string;
  }): GatewayBudgetDebitRow[] {
    return budgets.map(({ budget, bucketScopeId }) => ({
      tenantId,
      budgetId: budget.id,
      scope: budget.scopeType,
      scopeId: bucketScopeId,
      window: budget.window,
      virtualKeyId: sentinel,
      providerKey: null,
      gatewayRequestId: fact.requestId,
      amountNanoUsd: fact.amountNanoUsd,
      tokensInput: fact.tokensInput,
      tokensOutput: fact.tokensOutput,
      tokensCacheRead: fact.tokensCacheRead,
      tokensCacheWrite: fact.tokensCacheWrite,
      model: fact.model,
      durationMs: 0,
      status: "SUCCESS",
      occurredAt: Temporal.Instant.fromEpochMilliseconds(fact.occurredAtMs),
    }));
  }

  private ledgerStatus(payload: WriteGatewayDebitsPayload): GatewayBudgetLedgerStatus {
    if (payload.status === "confirmed") return "SUCCESS";
    return payload.error_type === "guardrail_blocked" ? "BLOCKED_BY_GUARDRAIL" : "PROVIDER_ERROR";
  }

  private debitRows(
    payload: WriteGatewayDebitsPayload,
    budgets: GatewayResolvedBudget[],
    providerKey: string | null,
  ): GatewayBudgetDebitRow[] {
    const usage = payload.usage ?? EMPTY_SPEND_USAGE;
    const status = this.ledgerStatus(payload);
    return budgets.map(({ budget, bucketScopeId }) => ({
      tenantId: payload.project_id,
      budgetId: budget.id,
      scope: budget.scopeType,
      scopeId: bucketScopeId,
      window: budget.window,
      virtualKeyId: payload.virtual_key_id,
      providerKey,
      gatewayRequestId: payload.gateway_request_id,
      amountNanoUsd: payload.cost_nano_usd,
      tokensInput: usage.input_tokens,
      tokensOutput: usage.output_tokens,
      tokensCacheRead: usage.cache_read_input_tokens,
      tokensCacheWrite: usage.cache_creation_input_tokens,
      model: payload.model || "unknown",
      durationMs: payload.duration_ms,
      status,
      occurredAt: Temporal.Instant.fromEpochMilliseconds(payload.occurred_at),
    }));
  }
}

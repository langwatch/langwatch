import {
  budgetAppliesToProvider,
  type GatewayBudgetDebitRow,
  type GatewayBudgetLedgerStatus,
  type GatewayResolvedBudget,
} from "@langwatch/gateway-contract";
import { createLogger } from "@langwatch/observability";
import { Temporal } from "@langwatch/time";

import type { WriteGatewayDebitsPayload } from "../eventing/gateway-debit.intent.ts";
import type { GatewayBudgetSpendRepository } from "../repositories/gateway-budget-spend.repository.ts";
import type { GatewayChangeEventsRepository } from "../repositories/gateway-change-event.repository.ts";
import { EMPTY_SPEND_USAGE } from "../rules/gateway-spend-projection.rules.ts";
import type { BudgetChangeEventDedupeService } from "./gateway-budget-change-dedupe.service.ts";
import type { GatewayBudgetCrossingService } from "./gateway-budget-crossing.service.ts";
import type { GatewayService } from "./gateway.service.ts";

const logger = createLogger("langwatch:gateway:spend-debits");

/**
 * The sole writer of gateway budget debits: one ledger row per budget a
 * request's outcome applies to, then its crossings, then a BUDGET_UPDATED so
 * the data plane stops enforcing against the spend its cached bundle was built with.
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
    if (budgets.length === 0) return;

    try {
      await this.collaborators.spend.insertDebitsForBudgets(
        this.debitRows(payload, budgets, providerKey),
      );
    } catch (error) {
      logger.error(
        { projectId: payload.project_id, gatewayRequestId: payload.gateway_request_id, error },
        "failed to write gateway budget debits",
      );
      // Rethrown for the outbox retry: a lost debit under-enforces the cap.
      throw error;
    }

    // Throws for the outbox retry too: the insert skips a budget the request
    // already debited, so a re-drive writes nothing twice.
    await this.collaborators.crossings.detect({
      tenantId: payload.project_id,
      organizationId: payload.organization_id,
      budgets,
    });

    await this.announce(payload, budgets);
  }

  /**
   * Best effort: the rows already landed, and a missed eviction costs freshness
   * until the bundle TTL, never correctness. A blocking budget is never held
   * back by the dedupe window, so enforcement never waits on it.
   */
  private async announce(
    payload: WriteGatewayDebitsPayload,
    budgets: GatewayResolvedBudget[],
  ): Promise<void> {
    try {
      const blocks = budgets.some(({ budget }) => budget.onBreach === "BLOCK");
      if (
        !blocks &&
        !(await this.collaborators.dedupe.shouldEmit({ projectId: payload.project_id }))
      )
        return;
      await this.collaborators.changes.append({
        organizationId: payload.organization_id,
        projectId: payload.project_id,
        kind: "BUDGET_UPDATED",
        payload: {
          gatewayRequestId: payload.gateway_request_id,
          virtualKeyId: payload.virtual_key_id,
          budgetIds: budgets.map(({ budget }) => budget.id),
        },
      });
    } catch (error) {
      logger.warn(
        {
          projectId: payload.project_id,
          virtualKeyId: payload.virtual_key_id,
          gatewayRequestId: payload.gateway_request_id,
          error,
        },
        "failed to emit BUDGET_UPDATED change event after debiting",
      );
    }
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

// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "@prisma/client";
import type { AppendStore } from "~/server/event-sourcing/projections/mapProjection.types";
import type { ProjectionStoreContext } from "~/server/event-sourcing/projections/projectionStoreContext";
import type {
  BudgetDebitRow,
  GatewayBudgetClickHouseRepository,
} from "~/server/gateway/budget.clickhouse.repository";
import type {
  ApplicableScopes,
  GatewayBudgetRepository,
} from "~/server/gateway/budget.repository";
import type { ChangeEventRepository } from "~/server/gateway/changeEvent.repository";
import type { GatewayBudgetDebitRecord } from "./gatewayBudgetDebits.mapProjection";

const logger = createLogger(
  "langwatch:governance:gateway-budget-debits-store",
);

export interface GatewayBudgetDebitsAppendStoreDeps {
  prisma: PrismaClient;
  budgetRepository: GatewayBudgetRepository;
  budgetCHRepository: GatewayBudgetClickHouseRepository;
  /**
   * Feed the Go gateway long-polls for cache invalidation. See
   * {@link GatewayBudgetDebitsAppendStore.notifyGateway} for why the emit
   * lives here and not in a subscriber of its own.
   */
  changeEvents: ChangeEventRepository;
}

/**
 * Write side of the ADR-075 Class C `gatewayBudgetDebits` map projection:
 * resolves which budgets a gateway request debits and appends one ClickHouse
 * ledger row per budget.
 *
 * The projection's `map` is pure, so every read this needs — the virtual key,
 * its project's org/team, the applicable budgets — happens here, which is also
 * where a failure is recoverable: the map job retries, and a debit that
 * survives neither the job nor its retries is re-derived by replay because the
 * derivation now lives on the replay path.
 *
 * **This store throws.** The reactor it replaces caught everything and logged
 * "failed to fold gateway trace into CH budget ledger", so a ClickHouse blip
 * silently deleted spend that had already been incurred. A projection store
 * that swallows an I/O failure re-creates exactly the hole this conversion
 * exists to close. Conditions that are genuinely "nothing to debit" — a span
 * from a deleted key, a key from another org, a key no budget covers — return
 * cleanly and are not errors.
 */
export class GatewayBudgetDebitsAppendStore
  implements AppendStore<GatewayBudgetDebitRecord>
{
  constructor(private readonly deps: GatewayBudgetDebitsAppendStoreDeps) {}

  async append(
    record: GatewayBudgetDebitRecord,
    _context: ProjectionStoreContext,
  ): Promise<void> {
    const { tenantId: projectId, virtualKeyId, gatewayRequestId } = record;

    const vk = await this.deps.prisma.virtualKey.findUnique({
      where: { id: virtualKeyId },
      select: { id: true, organizationId: true, principalUserId: true },
    });
    if (!vk) {
      logger.warn(
        { projectId, virtualKeyId, gatewayRequestId },
        "gateway span references unknown VK — no budget to debit",
      );
      return;
    }

    const project = await this.deps.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        teamId: true,
        team: { select: { organizationId: true } },
      },
    });
    if (!project?.team) {
      logger.warn(
        { projectId, virtualKeyId },
        "project missing team relation — no budget scope to resolve",
      );
      return;
    }

    // Cross-tenant guard: post-collapse VKs carry organizationId only, so the
    // trace's tenant project must live under the same org before its spend is
    // allowed to move that org's budgets.
    if (project.team.organizationId !== vk.organizationId) {
      logger.warn(
        { projectId, virtualKeyId, gatewayRequestId },
        "gateway span references cross-tenant VK — refusing to debit",
      );
      return;
    }

    const scopes: ApplicableScopes = {
      organizationId: project.team.organizationId,
      teamId: project.teamId,
      projectId: project.id,
      virtualKeyId: vk.id,
      principalUserId: vk.principalUserId,
    };
    const budgets = await this.deps.budgetRepository.applicableForRequest(
      scopes,
    );
    if (budgets.length === 0) return;

    const rows: BudgetDebitRow[] = budgets.map((budget) => ({
      tenantId: projectId,
      budgetId: budget.id,
      scope: budget.scopeType,
      scopeId: budget.scopeId,
      window: budget.window,
      virtualKeyId: vk.id,
      gatewayRequestId,
      amountUsd: record.amountUsd,
      tokensInput: record.tokensInput,
      tokensOutput: record.tokensOutput,
      // Carried over from the reactor as literal zeros. The per-span cache
      // counts ARE available (`SpanCostService.extractCacheTokens`), but
      // populating columns the ledger has always written as 0 would move
      // numbers on the usage page as a side effect of a durability change.
      // Filling them is a separate, deliberate change — it does not touch
      // AmountUSD and so cannot move a budget.
      tokensCacheRead: 0,
      tokensCacheWrite: 0,
      model: record.model,
      durationMs: record.durationMs,
      status: record.status,
      occurredAt: record.occurredAt,
    }));

    const { inserted } =
      await this.deps.budgetCHRepository.insertDebit(rows);

    if (inserted) {
      await this.notifyGateway({
        organizationId: project.team.organizationId,
        projectId,
        virtualKeyId: vk.id,
        gatewayRequestId,
        budgetIds: budgets.map((b) => b.id),
        amountUsd: record.amountUsd,
      });
    }
  }

  /**
   * Append the `BUDGET_UPDATED` change the gateway's `/changes` subscriber
   * reads to evict cached bundles, so the next request re-resolves against
   * fresh spend instead of the `Bundle.Config.Budget.SpentMicroUSD` frozen at
   * populate time.
   *
   * **Why it lives in the store rather than a subscriber of its own.** It is a
   * notification that derived state MOVED, so it is only correct when tied to
   * a write that actually happened. A subscriber sees the span, not whether the
   * debit landed: it would fire for spans that resolved to no budget, and — far
   * worse — it would fire on every replayed span, appending a change row per
   * historical request to a live revision feed and driving a cache-sweep storm
   * across every VK in the project. Gating on `inserted` gives the right
   * behaviour in one line: a replay over an intact ledger emits nothing, and a
   * replay that repairs a lost debit emits exactly one, which is precisely when
   * the gateway needs telling.
   *
   * **Why it is best-effort and not durable.** Losing it costs latency, not
   * correctness — the gateway's bundle TTL rolls and re-resolves regardless,
   * which is the property `budgets.feature` pins with "the gateway still stops
   * authorising once the budget is exhausted" even when "the process that would
   * have notified the gateway dies first". Making it durable would buy a faster
   * eviction at the price of an outbox row per gateway request, which is the
   * Postgres-row cost ADR-075 explicitly says to watch. So a failure here is
   * logged and swallowed: the ledger row is already committed, and throwing
   * would retry the whole map job — re-probing ClickHouse — to re-send a hint.
   */
  private async notifyGateway(input: {
    organizationId: string;
    projectId: string;
    virtualKeyId: string;
    gatewayRequestId: string;
    budgetIds: string[];
    amountUsd: string;
  }): Promise<void> {
    try {
      await this.deps.changeEvents.append({
        organizationId: input.organizationId,
        projectId: input.projectId,
        kind: "BUDGET_UPDATED",
        payload: {
          gatewayRequestId: input.gatewayRequestId,
          virtualKeyId: input.virtualKeyId,
          budgetIds: input.budgetIds,
          amountUsd: input.amountUsd,
        },
      });
    } catch (error) {
      logger.warn(
        {
          projectId: input.projectId,
          virtualKeyId: input.virtualKeyId,
          gatewayRequestId: input.gatewayRequestId,
          error,
        },
        "failed to emit BUDGET_UPDATED — gateway caches evict on bundle TTL instead",
      );
    }
  }
}

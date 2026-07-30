// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type {
  GatewayBudgetDebitService,
  ResolvedGatewayBudgetDebit,
} from "@ee/governance/services/gatewayBudgetDebit.service";
import { createLogger } from "@langwatch/observability";
import type {
  AppendStore,
  BulkAppendContext,
} from "~/server/event-sourcing.old/projections/mapProjection.types";
import type { ProjectionStoreContext } from "~/server/event-sourcing.old/projections/projectionStoreContext";
import type { GatewayBudgetClickHouseRepository } from "~/server/gateway/budget.clickhouse.repository";
import type { ChangeEventRepository } from "~/server/gateway/changeEvent.repository";
import { assertRecordsTenant, assertRecordTenant } from "./assertRecordTenant";
import type { GatewayBudgetDebitRecord } from "./gatewayBudgetDebits.mapProjection";

const logger = createLogger("langwatch:governance:gateway-budget-debits-store");

const STORE_NAME = "GatewayBudgetDebitsAppendStore";

export interface GatewayBudgetDebitsAppendStoreDeps {
  /**
   * Decides which budgets a request may move and shapes the rows that move
   * them (ADR-082 layer 3, retired; ground now ADR-102). Kept out of this store on purpose: a store that
   * also authorises needs four "and"s to describe.
   */
  debits: GatewayBudgetDebitService;
  budgetCHRepository: GatewayBudgetClickHouseRepository;
  /**
   * Feed the Go gateway long-polls for cache invalidation. See
   * {@link GatewayBudgetDebitsAppendStore.notifyGateway} for why the emit
   * lives here and not in a subscriber of its own.
   */
  changeEvents: ChangeEventRepository;
}

/**
 * Write side of the ADR-075 Class C (retired; ground now ADR-098)
 * `gatewayBudgetDebits` map projection:
 * appends the resolved ClickHouse ledger rows and tells the gateway when
 * spend actually moved.
 *
 * **This store throws.** The reactor it replaces caught everything and logged
 * "failed to fold gateway trace into CH budget ledger", so a ClickHouse blip
 * silently deleted spend that had already been incurred. A projection store
 * that swallows an I/O failure re-creates exactly the hole this conversion
 * exists to close. Conditions that are genuinely "nothing to debit" — a span
 * from a deleted key, a key from another org, a key no budget covers — resolve
 * to null in {@link GatewayBudgetDebitService} and are not errors.
 */
export class GatewayBudgetDebitsAppendStore
  implements AppendStore<GatewayBudgetDebitRecord>
{
  constructor(private readonly deps: GatewayBudgetDebitsAppendStoreDeps) {}

  async append(
    record: GatewayBudgetDebitRecord,
    context: ProjectionStoreContext,
  ): Promise<void> {
    assertRecordTenant({
      store: STORE_NAME,
      recordTenantId: record.tenantId,
      contextTenantId: context.tenantId,
    });
    const debit = await this.deps.debits.resolve(record);
    if (!debit) return;

    const { inserted } = await this.deps.budgetCHRepository.insertDebit(
      debit.rows,
    );
    if (inserted) await this.notifyGateway(debit);
  }

  /**
   * Batch form for the replay path.
   *
   * Rebuilding a window is the operation this projection exists for — the
   * store's own contract is that a debit lost to a failed handler is
   * "re-derived by replay" — so it is the one path that must not degrade into
   * a per-row write. `replayMapProjection` buffers a tenant's records and
   * flushes them here; resolving and inserting them one at a time would cost
   * three Postgres reads and one awaited ClickHouse INSERT per gateway span,
   * which is how a rebuild turns into a ClickHouse parts problem.
   *
   * The `inserted` gate survives the widening, per request id: only requests
   * whose rows were actually written notify the gateway, so a replay over an
   * intact ledger emits nothing and a replay that repairs lost debits emits
   * exactly one change per repaired request.
   */
  async bulkAppend(
    records: GatewayBudgetDebitRecord[],
    context: BulkAppendContext,
  ): Promise<void> {
    if (records.length === 0) return;
    assertRecordsTenant({
      store: STORE_NAME,
      records,
      contextTenantId: context.tenantId,
    });

    const debits = await this.deps.debits.resolveMany(records);
    if (debits.length === 0) return;

    const { insertedGatewayRequestIds } =
      await this.deps.budgetCHRepository.insertDebits(
        debits.flatMap((debit) => debit.rows),
      );
    if (insertedGatewayRequestIds.length === 0) return;

    // Concurrently, on purpose: this is the path that repairs many lost debits
    // at once, the notifications are independent of each other, and
    // `notifyGateway` swallows its own failures — so there is no ordering to
    // preserve and nothing here can reject.
    const inserted = new Set(insertedGatewayRequestIds);
    await Promise.all(
      debits
        .filter((debit) => inserted.has(debit.gatewayRequestId))
        .map((debit) => this.notifyGateway(debit)),
    );
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
   * Postgres-row cost the retired ADR-075 (ground now ADR-098) explicitly
   * says to watch. So a failure here is
   * logged and swallowed: the ledger row is already committed, and throwing
   * would retry the whole map job — re-probing ClickHouse — to re-send a hint.
   */
  private async notifyGateway(
    debit: ResolvedGatewayBudgetDebit,
  ): Promise<void> {
    try {
      await this.deps.changeEvents.append({
        organizationId: debit.organizationId,
        projectId: debit.projectId,
        kind: "BUDGET_UPDATED",
        payload: {
          gatewayRequestId: debit.gatewayRequestId,
          virtualKeyId: debit.virtualKeyId,
          budgetIds: debit.budgetIds,
          amountUsd: debit.amountUsd,
        },
      });
    } catch (error) {
      logger.warn(
        {
          projectId: debit.projectId,
          virtualKeyId: debit.virtualKeyId,
          gatewayRequestId: debit.gatewayRequestId,
          error,
        },
        "failed to emit BUDGET_UPDATED — gateway caches evict on bundle TTL instead",
      );
    }
  }
}

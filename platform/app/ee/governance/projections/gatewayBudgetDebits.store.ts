// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Write side of the `gatewayBudgetDebits` map: appends the resolved
 * ClickHouse ledger rows and tells the gateway when spend actually moved.
 * Throws on failure — a swallowed error here silently deletes spend that was
 * already incurred.
 */

import type {
  GatewayBudgetDebitService,
  ResolvedGatewayBudgetDebit,
} from "@ee/governance/services/gatewayBudgetDebit.service";
import type { AppendStore, BatchContext } from "@langwatch/event-sourcing";
import { createLogger } from "@langwatch/observability";
import type { GatewayBudgetClickHouseRepository } from "~/server/gateway/budget.clickhouse.repository";
import type { ChangeEventRepository } from "~/server/gateway/changeEvent.repository";
import { assertRecordsTenant } from "./assertRecordTenant";
import type { GatewayBudgetDebitRecord } from "./gatewayBudgetDebits.mapProjection";

const logger = createLogger("langwatch:governance:gateway-budget-debits-store");
const STORE_NAME = "GatewayBudgetDebitsAppendStore";

export interface GatewayBudgetDebitsAppendStoreDeps {
  debits: GatewayBudgetDebitService;
  budgetCHRepository: GatewayBudgetClickHouseRepository;
  changeEvents: ChangeEventRepository;
}

export function createGatewayBudgetDebitsStore(
  deps: GatewayBudgetDebitsAppendStoreDeps,
): AppendStore<GatewayBudgetDebitRecord> {
  async function notifyGateway(
    debit: ResolvedGatewayBudgetDebit,
  ): Promise<void> {
    try {
      await deps.changeEvents.append({
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

  return {
    kind: "append",
    async writeBatch(records, context: BatchContext) {
      if (records.length === 0) return;
      assertRecordsTenant({
        store: STORE_NAME,
        records,
        contextTenantId: context.tenantId,
      });

      const debits = await deps.debits.resolveMany(records);
      if (debits.length === 0) return;

      const { insertedGatewayRequestIds } =
        await deps.budgetCHRepository.insertDebits(
          debits.flatMap((debit) => debit.rows),
        );
      if (insertedGatewayRequestIds.length === 0) return;

      const inserted = new Set(insertedGatewayRequestIds);
      await Promise.all(
        debits
          .filter((debit) => inserted.has(debit.gatewayRequestId))
          .map((debit) => notifyGateway(debit)),
      );
    },
  };
}

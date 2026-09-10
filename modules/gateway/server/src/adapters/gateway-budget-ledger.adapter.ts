import type { GatewayClickHouseResolver } from "../app/gateway.infrastructure.ts";
import type { GatewayBudgetSpend } from "../app/gateway.infrastructure.ts";
import { GatewayBudgetClickHouseRepository } from "../repositories/clickhouse/clickhouse.gateway-budget.repository.ts";

/** Binds Gateway's ClickHouse ledger implementation to its technical port. */
export class GatewayBudgetLedgerAdapter {
  static create(resolveClient: GatewayClickHouseResolver): GatewayBudgetSpend {
    return new GatewayBudgetClickHouseRepository(resolveClient);
  }
}

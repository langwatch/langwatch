import type { GatewayClickHouseResolver } from "../ports/gateway-clickhouse.port.ts";
import type { GatewayBudgetSpendPort } from "../ports/gateway-budget-spend.port.ts";
import { GatewayBudgetClickHouseRepository } from "../repositories/clickhouse/clickhouse.gateway-budget.repository.ts";

/** Binds Gateway's ClickHouse ledger implementation to its technical port. */
export class GatewayBudgetLedgerAdapter {
  static create(resolveClient: GatewayClickHouseResolver): GatewayBudgetSpendPort {
    return new GatewayBudgetClickHouseRepository(resolveClient);
  }
}

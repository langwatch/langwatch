import type { GatewayClickHouseResolver } from "../ports/gateway-clickhouse.port";
import type { GatewayBudgetSpendPort } from "../ports/gateway-budget-spend.port";
import { GatewayBudgetClickHouseRepository } from "../repositories/clickhouse/clickhouse.gateway-budget.repository";

/** Binds Gateway's ClickHouse ledger implementation to its technical port. */
export class GatewayBudgetLedgerAdapter {
  static create(resolveClient: GatewayClickHouseResolver): GatewayBudgetSpendPort {
    return new GatewayBudgetClickHouseRepository(resolveClient);
  }
}

import type { GatewayClickHouseResolver } from "../ports/gateway-clickhouse.port.ts";
import type { GatewaySpendEventsPort } from "../ports/gateway-spend-events.port.ts";
import { GatewaySpendEventsRepository } from "../repositories/clickhouse/clickhouse.gateway-spend-events.repository.ts";

/** Binds Gateway's ClickHouse spend-event repository to its public port. */
export class GatewaySpendEventsClickHouseAdapter {
  static create(resolveClient: GatewayClickHouseResolver): GatewaySpendEventsPort {
    return new GatewaySpendEventsRepository(resolveClient);
  }
}

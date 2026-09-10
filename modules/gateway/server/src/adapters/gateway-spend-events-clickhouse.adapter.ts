import type { GatewayClickHouseResolver } from "../app/gateway.members.ts";
import type { GatewaySpendEvents } from "../ports/gateway-spend-events.port.ts";
import { GatewaySpendEventsRepository } from "../repositories/clickhouse/clickhouse.gateway-spend-events.repository.ts";

/** Binds Gateway's ClickHouse spend-event repository to its public port. */
export class GatewaySpendEventsClickHouseAdapter {
  static create(resolveClient: GatewayClickHouseResolver): GatewaySpendEvents {
    return new GatewaySpendEventsRepository(resolveClient);
  }
}

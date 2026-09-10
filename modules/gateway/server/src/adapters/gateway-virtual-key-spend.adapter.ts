import type { GatewayClickHouseResolver } from "../app/gateway.infrastructure.ts";
import { GatewayVirtualKeySpendRepository } from "../repositories/clickhouse/clickhouse.gateway-virtual-key-spend.repository.ts";
import type { GatewayVirtualKeySpendPort } from "../app/gateway.infrastructure.ts";

/** Binds the ClickHouse implementation to Gateway's virtual-key spend port. */
export class GatewayVirtualKeySpendAdapter {
  static create(resolveClient: GatewayClickHouseResolver): GatewayVirtualKeySpendPort {
    return new GatewayVirtualKeySpendRepository(resolveClient);
  }
}

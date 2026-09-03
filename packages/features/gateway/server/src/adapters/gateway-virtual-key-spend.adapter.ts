import type { GatewayClickHouseResolver } from "../ports/gateway-clickhouse.port";
import { GatewayVirtualKeySpendRepository } from "../repositories/clickhouse/clickhouse.gateway-virtual-key-spend.repository";
import type { GatewayVirtualKeySpendPort } from "../ports/gateway-virtual-key-spend.port";

/** Binds the ClickHouse implementation to Gateway's virtual-key spend port. */
export class GatewayVirtualKeySpendAdapter {
  static create(resolveClient: GatewayClickHouseResolver): GatewayVirtualKeySpendPort {
    return new GatewayVirtualKeySpendRepository(resolveClient);
  }
}

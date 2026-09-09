import type { GatewayClickHouseResolver } from "../ports/gateway-clickhouse.port.ts";
import { GatewayVirtualKeySpendRepository } from "../repositories/clickhouse/clickhouse.gateway-virtual-key-spend.repository.ts";
import type { GatewayVirtualKeySpendPort } from "../ports/gateway-virtual-key-spend.port.ts";

/** Binds the ClickHouse implementation to Gateway's virtual-key spend port. */
export class GatewayVirtualKeySpendAdapter {
  static create(resolveClient: GatewayClickHouseResolver): GatewayVirtualKeySpendPort {
    return new GatewayVirtualKeySpendRepository(resolveClient);
  }
}

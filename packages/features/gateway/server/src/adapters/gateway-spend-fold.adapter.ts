import type { FoldProjectionStore } from "@langwatch/eventing";
import {
  GatewaySpendFoldProjection,
  type GatewaySpendState,
} from "../projections/gateway-spend.projection";

export type { GatewaySpendState } from "../projections/gateway-spend.projection";

/** Creates Gateway's deterministic spend fold for process composition. */
export function createGatewaySpendFoldProjection(
  store: FoldProjectionStore<GatewaySpendState>,
): GatewaySpendFoldProjection {
  return new GatewaySpendFoldProjection({ store });
}

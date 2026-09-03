import type { FoldProjectionStore } from "@langwatch/eventing";
import {
  GatewaySpendFoldProjection,
  type GatewaySpendState,
} from "../projections/gateway-spend.projection";

export type { GatewaySpendState } from "../projections/gateway-spend.projection";

/** The fold's durable store, re-exported here because `index.ts` may not
 *  reach into `stores/` directly. */
export { GatewaySpendStore } from "../stores/gateway-spend/gateway-spend.store";

/** Creates Gateway's deterministic spend fold for process composition. */
export function createGatewaySpendFoldProjection(
  store: FoldProjectionStore<GatewaySpendState>,
): GatewaySpendFoldProjection {
  return new GatewaySpendFoldProjection({ store });
}

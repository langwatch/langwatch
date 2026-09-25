import type {
  FoldProjectionStore,
  ProjectionStoreContext,
  FoldStateRead,
} from "@langwatch/eventing";

import type { GatewaySpendState } from "../../eventing/gateway-spend.projection.ts";
import type { GatewaySpendEventsRepository } from "../../repositories/gateway-spend-events.repository.ts";

/**
 * FoldProjectionStore adapter for the gateway spend fold. `gateway_spend` round-trips the
 * WHOLE working state, so `get` decodes the last committed row; a version-stamped miss needs
 * `refoldOnStoreMiss` reintroduced, or it overwrites partial state from init().
 */
export class GatewaySpendStore implements FoldProjectionStore<GatewaySpendState> {
  static create(repo: GatewaySpendEventsRepository): GatewaySpendStore {
    return new GatewaySpendStore(repo);
  }

  private constructor(private readonly repo: GatewaySpendEventsRepository) {}

  async get(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<FoldStateRead<GatewaySpendState>> {
    const folded = await this.repo.findForFold({
      tenantId: String(context.tenantId),
      gatewayRequestId: aggregateId,
    });
    return folded === null ? { kind: "empty" } : { kind: "folded", state: folded };
  }

  async store(state: GatewaySpendState, context: ProjectionStoreContext): Promise<void> {
    await this.repo.upsertFromFold([
      {
        tenantId: String(context.tenantId),
        gatewayRequestId: String(context.aggregateId),
        state,
      },
    ]);
  }

  async storeBatch(
    entries: {
      state: GatewaySpendState;
      context: ProjectionStoreContext;
    }[],
  ): Promise<void> {
    if (entries.length === 0) return;
    await this.repo.upsertFromFold(
      entries.map(({ state, context }) => ({
        tenantId: String(context.tenantId),
        gatewayRequestId: String(context.aggregateId),
        state,
      })),
    );
  }
}

import type { FoldProjectionStore, ProjectionStoreContext } from "@langwatch/eventing";
import type { GatewaySpendEvents } from "../../ports/gateway-spend-events.port.ts";
import type { GatewaySpendState } from "../../projections/gateway-spend.projection.ts";

/**
 * FoldProjectionStore adapter for the gateway spend fold. `gateway_spend` round-trips the
 * WHOLE working state, so `get` decodes the last committed row; a version-stamped miss needs
 * `refoldOnStoreMiss` reintroduced, or it overwrites partial state from init().
 */
export class GatewaySpendStore implements FoldProjectionStore<GatewaySpendState> {
  static create(repo: GatewaySpendEvents): GatewaySpendStore {
    return new GatewaySpendStore(repo);
  }

  private constructor(private readonly repo: GatewaySpendEvents) {}

  async tryGet(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<GatewaySpendState | null> {
    return this.repo.tryReadForFold({
      tenantId: String(context.tenantId),
      gatewayRequestId: aggregateId,
    });
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
    entries: Array<{
      state: GatewaySpendState;
      context: ProjectionStoreContext;
    }>,
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

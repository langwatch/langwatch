import type { GatewaySpendEventsRepository } from "~/server/gateway/spendEvents.clickhouse.repository";
import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";
import type { GatewaySpendState } from "./gatewaySpend.foldProjection";

/**
 * FoldProjectionStore adapter for the gateway spend fold.
 *
 * The `gateway_spend` row round-trips the WHOLE working state (every field
 * is an explicit column), so `get` decodes the last committed row and the
 * delivery path never refolds from the event log in steady state. Rows
 * stamped with an older projection version report a miss; combined with
 * the projection's `refoldOnStoreMiss`, that population self-heals one
 * aggregate at a time with no backfill migration.
 *
 * No applied-event bookkeeping rides here: the fold is absolute-writes-only
 * and every command carries a per-(request, lifecycle-step) idempotency key
 * at the event store, so a redelivered batch re-sets identical state and
 * the ReplacingMergeTree version (the fold's monotonic updatedAt) replaces
 * rather than duplicates.
 */
export class GatewaySpendStore
  implements FoldProjectionStore<GatewaySpendState>
{
  constructor(private readonly repo: GatewaySpendEventsRepository) {}

  async get(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<GatewaySpendState | null> {
    return this.repo.readForFold({
      tenantId: String(context.tenantId),
      gatewayRequestId: aggregateId,
    });
  }

  async store(
    state: GatewaySpendState,
    context: ProjectionStoreContext,
  ): Promise<void> {
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

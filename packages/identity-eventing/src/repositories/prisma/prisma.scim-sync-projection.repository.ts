import type {
  ScimRevokeCause,
  ScimSyncFailure,
  ScimSyncLifecycleState,
  ScimSyncState,
} from "@langwatch/identity-contract";
import type { ScimSyncReadRepository } from "@langwatch/identity-server";
import type {
  Prisma,
  PrismaClient,
  ScimSyncState as ScimSyncRow,
} from "@langwatch/prisma-client/generated";
import type {
  ProjectionStoreContext,
  StateProjectionStore,
  StoredProjection,
} from "@langwatch/eventing";
import type { ScimSyncFoldState } from "../../scim-sync/projections/scimSyncState.foldProjection";

/** The one model this fold writes and its guards read. */
export type PrismaScimSyncProjectionDatabase = Pick<PrismaClient, "scimSyncState">;

/**
 * The directory-sync pipeline's projection store (D08): the Postgres
 * `ScimSyncState` head and its cursor, written under the queue's per-sync
 * lock, plus the read the guards run against.
 *
 * One row per aggregate, so the cursor rides on the row itself rather than in
 * a sibling table — and the row is written last-field-wins in one upsert,
 * which makes the whole apply the commit marker. A crash before it leaves
 * nothing; a crash after it is a completed apply.
 *
 * Nothing outside the fold writes here. A hand-edited row is not a
 * configuration change, it is a value the next event or the next replay
 * overwrites — which matters most for `deadLetters`: clearing one by hand
 * would say a removal happened that did not.
 */
export class PrismaScimSyncProjectionRepository
  implements StateProjectionStore<ScimSyncFoldState>, ScimSyncReadRepository
{
  static create(database: PrismaScimSyncProjectionDatabase): PrismaScimSyncProjectionRepository {
    return new PrismaScimSyncProjectionRepository(database);
  }

  private constructor(private readonly database: PrismaScimSyncProjectionDatabase) {}

  async tryLoad(
    key: string,
    _context: ProjectionStoreContext,
  ): Promise<StoredProjection<ScimSyncFoldState> | null> {
    const row = await this.database.scimSyncState.findUnique({ where: { id: key } });
    if (!row) return null;
    return {
      state: {
        ...scimSyncRowToState(row),
        CreatedAt: row.createdAt.getTime(),
        UpdatedAt: row.updatedAt.getTime(),
        LastEventOccurredAt: row.occurredAt.getTime(),
      },
      cursor: {
        acceptedAt: row.acceptedAt.getTime(),
        eventId: row.lastEventId,
      },
      occurredAt: row.occurredAt.getTime(),
      createdAt: row.createdAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
      version: row.projectionVersion,
    };
  }

  async store(
    projection: StoredProjection<ScimSyncFoldState>,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const id = context.aggregateId;
    const { state } = projection;
    const columns = {
      connectionId: state.connectionId,
      organizationId: state.organizationId,
      state: state.state,
      lastPushedAt: state.lastPushedAtMs === null ? null : new Date(state.lastPushedAtMs),
      // Cast at the ONE seam that knows both shapes. `ScimSyncFailure` is a
      // plain record of scalars, so it is a valid `InputJsonValue`; Prisma's
      // generated input type cannot see that through a named interface, and
      // widening the reducer's state to `Json` to satisfy it would lose the
      // typing on the side that actually reads these.
      lastFailure: (state.lastFailure ?? undefined) as unknown as Prisma.InputJsonValue,
      deadLetters: state.deadLetters as unknown as Prisma.InputJsonValue,
      revokedCause: state.revokedCause,
      occurredAt: new Date(projection.occurredAt),
      lastEventId: projection.cursor.eventId,
      acceptedAt: new Date(projection.cursor.acceptedAt),
      projectionVersion: projection.version,
      // Business time, from the events — not `now()`. A row whose timestamps
      // came from the clock would differ from the row a replay rebuilds, and
      // whole-row parity is what this projection promises.
      createdAt: new Date(state.createdAtMs),
      updatedAt: new Date(state.updatedAtMs),
    };
    await this.database.scimSyncState.upsert({
      where: { id },
      create: { id, ...columns },
      update: columns,
    });
  }

  /**
   * The guards' read. Organization-scoped as well as keyed by the sync, so a
   * command whose tenant and aggregate disagree resolves to nothing rather
   * than to another organization's sync.
   */
  async findSync({
    scimSyncId,
    organizationId,
  }: {
    scimSyncId: string;
    organizationId: string;
  }): Promise<ScimSyncState | null> {
    const row = await this.database.scimSyncState.findFirst({
      where: { id: scimSyncId, organizationId },
    });
    return row ? scimSyncRowToState(row) : null;
  }
}

/**
 * One stored row back into the reducer's state. Exported because the failure
 * surface and the guards' read need the same translation, and two copies of
 * it would eventually disagree about what a JSON column means.
 */
export function scimSyncRowToState(row: ScimSyncRow): ScimSyncState {
  return {
    scimSyncId: row.id,
    connectionId: row.connectionId,
    organizationId: row.organizationId,
    state: row.state as ScimSyncLifecycleState,
    lastPushedAtMs: row.lastPushedAt?.getTime() ?? null,
    lastFailure: row.lastFailure ? (row.lastFailure as unknown as ScimSyncFailure) : null,
    deadLetters: Array.isArray(row.deadLetters)
      ? (row.deadLetters as unknown as ScimSyncFailure[])
      : [],
    revokedCause: (row.revokedCause as ScimRevokeCause | null) ?? null,
    createdAtMs: row.createdAt.getTime(),
    updatedAtMs: row.updatedAt.getTime(),
  };
}
